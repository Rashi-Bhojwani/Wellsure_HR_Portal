import { randomUUID } from "node:crypto";
import request from "supertest";
import sharp from "sharp";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { HELPDESK_SETTING_KEYS } from "../../../lib/helpdeskSettings";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";

export async function createTestHelpdeskCategory(opts: { isSensitive?: boolean; defaultAssigneeEmployeeId?: string | null; isActive?: boolean } = {}) {
  const code = `TEST_HD_${randomUUID().slice(0, 8).toUpperCase()}`;
  return prisma.helpdeskCategory.create({
    data: {
      code,
      name: `Test ${code}`,
      isSensitive: opts.isSensitive ?? false,
      isActive: opts.isActive ?? true,
      defaultAssigneeEmployeeId: opts.defaultAssigneeEmployeeId ?? null,
    },
  });
}

// Deletes the categories and — through the schema-driven engine — every
// ticket filed under them, their messages, attachments and stored files.
// Run BEFORE deleting the fixture employees.
export async function cleanupTestHelpdeskCategories(ids: string[]): Promise<void> {
  await deleteWithDependents("HelpdeskCategory", ids);
}

// SystemSetting keys are global singletons shared by the whole run: restore
// exactly what was there (seeded value or nothing).
export async function snapshotHelpdeskSettings(): Promise<() => Promise<void>> {
  const keys = Object.values(HELPDESK_SETTING_KEYS);
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  return async () => {
    await prisma.systemSetting.deleteMany({ where: { key: { in: keys } } });
    for (const row of rows) await prisma.systemSetting.create({ data: { key: row.key, value: row.value as never, updatedByUserId: null } });
  };
}

export function raise(token: string, fields: Record<string, string>, files: Array<{ buffer: Buffer; filename: string; contentType: string }> = []) {
  let req = request(app).post("/api/helpdesk/tickets").set(...authHeader(token));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  for (const f of files) req = req.attach("files", f.buffer, { filename: f.filename, contentType: f.contentType });
  return req;
}

export function reply(token: string, ticketId: string, fields: Record<string, string>, files: Array<{ buffer: Buffer; filename: string; contentType: string }> = []) {
  let req = request(app).post(`/api/helpdesk/tickets/${ticketId}/messages`).set(...authHeader(token));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  for (const f of files) req = req.attach("files", f.buffer, { filename: f.filename, contentType: f.contentType });
  return req;
}

// A phone photo of a payslip, as it really arrives: camera make + GPS.
export async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: "#ddd" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "PhoneCo", Model: "X1", Copyright: "SECRET-MARKER" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "26/1 27/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "74/1 38/1 0/1" },
    })
    .toBuffer();
}

export async function pngWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 4, background: "#0a0" } })
    .png()
    .withExif({ IFD0: { Make: "PhoneCo", Copyright: "SECRET-MARKER" } })
    .toBuffer();
}
