import sharp from "sharp";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storageService } from "../../../integrations/storage";
import { prisma } from "../../../lib/prisma";
import { PEOPLE_DOCUMENTS_SETTING_KEYS } from "../../../lib/peopleDocumentsSettings";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  cleanupTestRole,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  grantPermissions,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { clearPhotoTokenUserCache, issuePhotoToken, verifyPhotoToken } from "../photos";
import { setSetting, snapshotPeopleDocumentsSettings } from "./peopleTestHelpers";

// A JPEG carrying camera + GPS EXIF — what a phone photo actually looks like.
async function jpegWithGps(width = 1200, height = 900): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: "#3a7" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "PhoneCo", Model: "X1" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "26/1 27/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "74/1 38/1 0/1" },
    })
    .toBuffer();
}

describe("Employee photos (upload, re-encode, serve)", () => {
  const hrRole = `TEST_PHOTO_HR_${Date.now()}`;
  let org: TestOrgMasters;
  let restoreSettings: () => Promise<void>;
  let self: { employeeId: string; employeeCode: string; userId: string };
  let colleague: { employeeId: string; employeeCode: string; userId: string };
  let hr: { employeeId: string; employeeCode: string; userId: string };
  let selfToken: string;
  let colleagueToken: string;
  let hrToken: string;

  beforeAll(async () => {
    restoreSettings = await snapshotPeopleDocumentsSettings();
    org = await createEmployeeTestOrgMasters();
    await grantPermissions(hrRole, ["employee.edit", "employee.view"]);
    self = await createFullTestEmployee(org);
    colleague = await createFullTestEmployee(org);
    hr = await createFullTestEmployee(org, { roleCode: hrRole });
    // HR must be ALL-scoped for the in-scope check; a TEST_* role code
    // resolves to SELF scope, so give HR the literal HR_ADMIN role too.
    const hrAdmin = await prisma.role.upsert({ where: { code: "HR_ADMIN" }, create: { code: "HR_ADMIN", name: "HR Admin" }, update: {} });
    await prisma.userRole.create({ data: { userId: hr.userId, roleId: hrAdmin.id } });
    selfToken = await loginAs(self.employeeCode);
    colleagueToken = await loginAs(colleague.employeeCode);
    hrToken = await loginAs(hr.employeeCode);
  });

  afterAll(async () => {
    for (const e of [self, colleague, hr]) await cleanupFullTestEmployee(e.employeeId);
    await cleanupTestRole(hrRole);
    await cleanupEmployeeTestOrgMasters(org);
    await restoreSettings();
  });

  async function photoToken(accessToken: string): Promise<string> {
    const res = await request(app).get("/api/people/photo-token").set(...authHeader(accessToken));
    expect(res.status).toBe(200);
    return res.body.token as string;
  }

  it("re-encodes to WebP at both sizes and strips every byte of metadata, including GPS", async () => {
    const input = await jpegWithGps();
    expect((await sharp(input).metadata()).exif).toBeDefined(); // the fixture really carries EXIF

    const res = await request(app).put("/api/employees/me/photo").set(...authHeader(selfToken)).attach("file", input, { filename: "me.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    const personal = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: self.employeeId } });
    expect(personal.photoVersion).toBe(res.body.photoVersion);

    for (const [key, maxSide] of [
      [personal.photoStorageKey!, 512],
      [personal.photoThumbStorageKey!, 96],
    ] as const) {
      const stored = await storageService.getObject(key);
      const meta = await sharp(stored.body).metadata();
      expect(stored.contentType).toBe("image/webp");
      expect(meta.format).toBe("webp");
      expect(Math.max(meta.width!, meta.height!)).toBe(maxSide);
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(stored.body.includes(Buffer.from("PhoneCo"))).toBe(false);
    }
    const thumb = await sharp((await storageService.getObject(personal.photoThumbStorageKey!)).body).metadata();
    expect([thumb.width, thumb.height]).toEqual([96, 96]);

    const audit = await prisma.auditLog.findFirst({ where: { entityId: self.employeeId, action: "employee.photo.self_updated" } });
    expect(audit).not.toBeNull();
  });

  it("judges the file by what it decodes as, not its name or declared type", async () => {
    const text = Buffer.from("definitely not an image");
    const res = await request(app).put("/api/employees/me/photo").set(...authHeader(selfToken)).attach("file", text, { filename: "photo.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_UPLOAD");

    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).gif().toBuffer();
    const gifRes = await request(app).put("/api/employees/me/photo").set(...authHeader(selfToken)).attach("file", gif, { filename: "a.png", contentType: "image/png" });
    expect(gifRes.status).toBe(400);
  });

  it("enforces the admin-set size limit per request", async () => {
    await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.photoMaxUploadMb, 0.001); // ~1 KB
    const res = await request(app).put("/api/employees/me/photo").set(...authHeader(selfToken)).attach("file", await jpegWithGps(), { filename: "me.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/limit/);
    await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.photoMaxUploadMb, 5);
  });

  it("replacing a photo deletes the old stored objects", async () => {
    const before = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: self.employeeId } });
    const res = await request(app).put("/api/employees/me/photo").set(...authHeader(selfToken)).attach("file", await jpegWithGps(640, 640), { filename: "new.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(200);
    expect(res.body.photoVersion).not.toBe(before.photoVersion);
    await expect(storageService.getObject(before.photoStorageKey!)).rejects.toThrow();
    await expect(storageService.getObject(before.photoThumbStorageKey!)).rejects.toThrow();
  });

  it("serves the photo only with a valid photo token, cacheable per version", async () => {
    const t = await photoToken(colleagueToken);
    const url = `/api/people/photos/${self.employeeId}/thumb`;
    const ok = await request(app).get(url).query({ t, v: "x" });
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toBe("image/webp");
    expect(ok.headers["cache-control"]).toBe("private, max-age=86400");

    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).query({ t: `${t}x` })).status).toBe(401);
    // An access token is not a photo token.
    expect((await request(app).get(url).query({ t: colleagueToken })).status).toBe(401);
    // A bearer header doesn't substitute for the photo token either.
    expect((await request(app).get(url).set(...authHeader(colleagueToken))).status).toBe(401);
  });

  it("photo tokens expire, and stop working as soon as the account is deactivated", async () => {
    const { token } = issuePhotoToken(colleague.userId, Date.now() - 2 * 60 * 60 * 1000);
    expect(verifyPhotoToken(token)).toBeNull();

    const live = await photoToken(colleagueToken);
    await prisma.user.update({ where: { id: colleague.userId }, data: { status: "DEACTIVATED" } });
    clearPhotoTokenUserCache();
    expect((await request(app).get(`/api/people/photos/${self.employeeId}/thumb`).query({ t: live })).status).toBe(401);
    await prisma.user.update({ where: { id: colleague.userId }, data: { status: "ACTIVE" } });
    clearPhotoTokenUserCache();
  });

  it("a separated employee's photo is hidden from colleagues but not from HR", async () => {
    await prisma.employee.update({ where: { id: self.employeeId }, data: { status: "SEPARATED" } });
    const url = `/api/people/photos/${self.employeeId}/full`;
    expect((await request(app).get(url).query({ t: await photoToken(colleagueToken) })).status).toBe(404);
    expect((await request(app).get(url).query({ t: await photoToken(hrToken) })).status).toBe(200);
    await prisma.employee.update({ where: { id: self.employeeId }, data: { status: "ACTIVE" } });
  });

  // PEEPS-BEGIN avatars
  // Owner decision (Peeps avatars and directory): only the employee adds or changes their own photo. HR and the directors can only remove someone
  // else's, with a reason (backend/src/modules/avatars, tested in avatars.test.ts). This test used to have HR set the photo.
  it("nobody sets someone else's photo, not even employee.edit holders; the owner does; removing clears keys and files", async () => {
    const jpg = await jpegWithGps(300, 300);
    const denied = await request(app).put(`/api/employees/${self.employeeId}/photo`).set(...authHeader(colleagueToken)).attach("file", jpg, { filename: "x.jpg", contentType: "image/jpeg" });
    expect(denied.status).toBe(403);

    const byHr = await request(app).put(`/api/employees/${self.employeeId}/photo`).set(...authHeader(hrToken)).attach("file", jpg, { filename: "x.jpg", contentType: "image/jpeg" });
    expect(byHr.status).toBe(403);
    expect(JSON.stringify(byHr.body)).toContain("PHOTO_OWNER_ONLY");
    const bySelf = await request(app).put("/api/employees/me/photo").set(...authHeader(selfToken)).attach("file", jpg, { filename: "x.jpg", contentType: "image/jpeg" });
    expect(bySelf.status).toBe(200);
    // PEEPS-END

    const current = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: self.employeeId } });
    expect((await request(app).delete("/api/employees/me/photo").set(...authHeader(selfToken))).status).toBe(204);
    const after = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: self.employeeId } });
    expect([after.photoStorageKey, after.photoThumbStorageKey, after.photoVersion]).toEqual([null, null, null]);
    await expect(storageService.getObject(current.photoStorageKey!)).rejects.toThrow();
  });

  it("the old raw photoStorageKey field can no longer be set through the profile APIs", async () => {
    const res = await request(app).patch("/api/employees/me").set(...authHeader(selfToken)).send({ photoStorageKey: "employees/someone-else/documents/secret.pdf", currentAddress: "New address" });
    expect(res.status).toBe(204);
    const personal = await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: self.employeeId } });
    expect(personal.photoStorageKey).toBeNull();
    expect(personal.currentAddress).toBe("New address");
  });
});
