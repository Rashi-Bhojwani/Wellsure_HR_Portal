import request from "supertest";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storageService } from "../../../integrations/storage";
import { prisma } from "../../../lib/prisma";
import { PEOPLE_DOCUMENTS_SETTING_KEYS } from "../../../lib/peopleDocumentsSettings";
import { cleanupTestCategories, createTestCategory, fetchSignedUrl, pdf } from "../../documents/__tests__/documentsTestHelpers";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";
import { setSetting, snapshotPeopleDocumentsSettings } from "../../people/__tests__/peopleTestHelpers";
import { cleanupTestHelpdeskCategories, createTestHelpdeskCategory, jpegWithGps, pngWithExif, raise, reply } from "./helpdeskTestHelpers";

// Helpdesk attachments go through the same pipeline as Document Center
// uploads (user decision 6): size/type/extension/magic checks, and images
// re-encoded with every byte of metadata (EXIF incl. GPS) stripped — a
// photographed payslip or ID is exactly the leak case. The Document Center
// half of this file covers the gap commit C left (images stored as-is).
describe("Upload pipeline: helpdesk attachments and Document Center images", () => {
  let org: TestOrgMasters;
  let restoreDocSettings: () => Promise<void>;
  const helpdeskCategoryIds: string[] = [];
  const documentCategoryIds: string[] = [];
  let categoryId: string;
  type Person = { employeeId: string; employeeCode: string; userId: string };
  const people = {} as Record<"hr" | "raiser" | "other", Person>;
  const tokens = {} as Record<keyof typeof people, string>;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    restoreDocSettings = await snapshotPeopleDocumentsSettings();
    people.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    people.raiser = await createFullTestEmployee(org);
    people.other = await createFullTestEmployee(org);
    for (const key of Object.keys(people) as Array<keyof typeof people>) tokens[key] = await loginAs(people[key].employeeCode);
    categoryId = (await createTestHelpdeskCategory()).id;
    helpdeskCategoryIds.push(categoryId);
  });

  afterAll(async () => {
    await cleanupTestHelpdeskCategories(helpdeskCategoryIds);
    await cleanupTestCategories(documentCategoryIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await restoreDocSettings();
  });

  async function storedAttachments(ticketId: string) {
    return prisma.helpdeskAttachment.findMany({ where: { message: { ticketId } }, orderBy: { fileName: "asc" } });
  }

  async function expectNoMetadata(body: Buffer) {
    const meta = await sharp(body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(body.includes(Buffer.from("PhoneCo"))).toBe(false);
    expect(body.includes(Buffer.from("SECRET-MARKER"))).toBe(false);
  }

  it("JPEG and PNG attachments are stored re-encoded with no EXIF/GPS; a PDF is stored as-is", async () => {
    const jpeg = await jpegWithGps();
    const png = await pngWithExif();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined(); // the fixtures really carry metadata
    expect((await sharp(png).metadata()).exif).toBeDefined();
    const doc = pdf("Payslip");

    const res = await raise(tokens.raiser, { categoryId, subject: "Payslip photo", body: "See attached" }, [
      { buffer: jpeg, filename: "a-payslip.jpg", contentType: "image/jpeg" },
      { buffer: png, filename: "b-screen.png", contentType: "image/png" },
      { buffer: doc, filename: "c-letter.pdf", contentType: "application/pdf" },
    ]);
    expect(res.status).toBe(201);
    const [a, b, c] = await storedAttachments(res.body.id);

    for (const att of [a!, b!]) {
      const stored = await storageService.getObject(att.fileKey);
      await expectNoMetadata(stored.body);
      expect(att.sizeBytes).toBe(stored.body.length); // the size recorded is the re-encoded file's
    }
    expect((await sharp((await storageService.getObject(a!.fileKey)).body).metadata()).format).toBe("jpeg");
    expect((await sharp((await storageService.getObject(b!.fileKey)).body).metadata()).format).toBe("png");
    expect((await storageService.getObject(c!.fileKey)).body.equals(doc)).toBe(true);
  });

  it("rejects a disguised file, a mismatched extension, a disallowed type, an oversize file and too many files — storing nothing", async () => {
    const before = await prisma.helpdeskTicket.count({ where: { raisedByEmployeeId: people.raiser.employeeId } });
    const cases: Array<{ buffer: Buffer; filename: string; contentType: string }[]> = [
      [{ buffer: Buffer.from("MZ\x90\x00 not really a pdf"), filename: "invoice.pdf", contentType: "application/pdf" }], // magic mismatch
      [{ buffer: pdf(), filename: "invoice.jpg", contentType: "application/pdf" }], // extension mismatch
      [{ buffer: Buffer.from("#!/bin/sh\necho hi"), filename: "run.sh", contentType: "application/x-sh" }], // type not allowed
    ];
    for (const files of cases) {
      const res = await raise(tokens.raiser, { categoryId, subject: "Bad upload", body: "x" }, files);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_UPLOAD");
    }

    const four = Array.from({ length: 4 }, (_, i) => ({ buffer: pdf(`p${i}`), filename: `p${i}.pdf`, contentType: "application/pdf" }));
    const tooMany = await raise(tokens.raiser, { categoryId, subject: "Too many", body: "x" }, four);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toBe("Attach at most 3 files.");

    // The admin-set size limit applies per request.
    await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.documentMaxUploadMb, 0.001);
    const big = await raise(tokens.raiser, { categoryId, subject: "Big", body: "x" }, [{ buffer: await jpegWithGps(), filename: "big.jpg", contentType: "image/jpeg" }]);
    expect(big.status).toBe(400);
    // …and so does the allowed-types list.
    await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.documentMaxUploadMb, 10);
    await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.documentAllowedMimeTypes, ["application/pdf"]);
    const png = await raise(tokens.raiser, { categoryId, subject: "PNG", body: "x" }, [{ buffer: await pngWithExif(), filename: "s.png", contentType: "image/png" }]);
    expect(png.status).toBe(400);
    await restoreDocSettings();
    restoreDocSettings = await snapshotPeopleDocumentsSettings();

    expect(await prisma.helpdeskTicket.count({ where: { raisedByEmployeeId: people.raiser.employeeId } })).toBe(before);
  });

  it("downloads: the raiser and HR get a short-lived URL; another employee gets 404; an internal note's attachment is invisible to the raiser", async () => {
    const res = await raise(tokens.raiser, { categoryId, subject: "Doc", body: "x" }, [{ buffer: pdf("Mine"), filename: "mine.pdf", contentType: "application/pdf" }]);
    const [att] = await storedAttachments(res.body.id);

    const own = await request(app).post(`/api/helpdesk/attachments/${att!.id}/download`).set(...authHeader(tokens.raiser));
    expect(own.status).toBe(200);
    expect(own.body.expiresInSeconds).toBe(60);
    const fetched = await fetchSignedUrl(own.body.url);
    expect(fetched.status).toBe(200);
    expect((fetched.body as Buffer).equals((await storageService.getObject(att!.fileKey)).body)).toBe(true);

    expect((await request(app).post(`/api/helpdesk/attachments/${att!.id}/download`).set(...authHeader(tokens.hr))).status).toBe(200);
    expect((await request(app).post(`/api/helpdesk/attachments/${att!.id}/download`).set(...authHeader(tokens.other))).status).toBe(404);

    const note = await reply(tokens.hr, res.body.id, { body: "internal scan", isInternalNote: "true" }, [{ buffer: pdf("Internal"), filename: "internal.pdf", contentType: "application/pdf" }]);
    expect(note.status).toBe(201);
    const internal = (await storedAttachments(res.body.id)).find((a) => a.fileName === "internal.pdf")!;
    expect((await request(app).post(`/api/helpdesk/attachments/${internal.id}/download`).set(...authHeader(tokens.raiser))).status).toBe(404);
    expect((await request(app).post(`/api/helpdesk/attachments/${internal.id}/download`).set(...authHeader(tokens.hr))).status).toBe(200);
  });

  it("Document Center: an HR-uploaded image is stored with no EXIF/GPS too (the commit C gap)", async () => {
    const category = await createTestCategory("COMPANY");
    documentCategoryIds.push(category.id);
    const res = await request(app)
      .post("/api/documents/company")
      .set(...authHeader(tokens.hr))
      .field("title", "Office map")
      .field("categoryId", category.id)
      .attach("file", await jpegWithGps(), { filename: "map.jpg", contentType: "image/jpeg" });
    expect(res.status).toBe(201);
    const row = await prisma.companyDocument.findUniqueOrThrow({ where: { id: res.body.id } });
    await expectNoMetadata((await storageService.getObject(row.fileKey)).body);

    const empCategory = await createTestCategory("EMPLOYEE");
    documentCategoryIds.push(empCategory.id);
    const empRes = await request(app)
      .post(`/api/documents/employees/${people.raiser.employeeId}`)
      .set(...authHeader(tokens.hr))
      .field("title", "ID photo")
      .field("categoryId", empCategory.id)
      .field("visibleToEmployee", "true")
      .attach("file", await pngWithExif(), { filename: "id.png", contentType: "image/png" });
    expect(empRes.status).toBe(201);
    const empRow = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: empRes.body.id } });
    await expectNoMetadata((await storageService.getObject(empRow.fileKey)).body);
  });
});
