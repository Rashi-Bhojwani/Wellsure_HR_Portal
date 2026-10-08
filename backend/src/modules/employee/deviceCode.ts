import { prisma } from "../../lib/prisma";
import type { DeviceCodeCheckResult } from "./types";
import { inForceOn } from "../../lib/effectiveDating";

// Employee Codes are permanent and never reused (spec §3), even though the
// biometric machine's own device user IDs are eventually reassigned once
// an employee separates. Checks whether the raw ID entered as the Device
// User ID collides with an Employee Code already on record (any status —
// separated or not) and, if so, suggests the next free "<id>-N" code.
export async function checkDeviceUserId(deviceUserId: string): Promise<DeviceCodeCheckResult> {
  const existing = await prisma.employee.findUnique({
    where: { employeeCode: deviceUserId },
    include: { nameHistory: { where: inForceOn() } },
  });
  if (!existing) {
    return { deviceUserId, suggestedEmployeeCode: deviceUserId, collision: null };
  }

  let suffix = 2;
  let candidate = `${deviceUserId}-${suffix}`;
  // Sequential by nature: each guess depends on the last one being taken.
  while (await prisma.employee.findUnique({ where: { employeeCode: candidate } })) {
    suffix += 1;
    candidate = `${deviceUserId}-${suffix}`;
  }

  return {
    deviceUserId,
    suggestedEmployeeCode: candidate,
    collision: {
      employeeCode: existing.employeeCode,
      fullName: existing.nameHistory[0]?.fullName ?? existing.employeeCode,
      separatedOn: existing.lastWorkingDate ? existing.lastWorkingDate.toISOString().slice(0, 10) : null,
    },
  };
}
