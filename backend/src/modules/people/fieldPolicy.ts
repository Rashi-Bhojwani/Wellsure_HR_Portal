import type { DirectoryToggleableField } from "@shared/constants/peopleDocuments";

// The People directory's allowlist (Phase 5 commit C). EVERY column of
// Employee and EmployeePersonal must be classified here — the directory
// guard test (people/__tests__/fieldPolicy.test.ts) fails, naming the
// column, the moment a migration adds one that isn't. That's the point: a
// new personal-data column must be a deliberate "show" decision, never
// something that leaks into a colleague-facing response by default.
//
//   always   — shown to every signed-in colleague
//   setting  — shown only while that toggle is on in System Settings →
//              People & Documents (one company-wide setting)
//   never    — never leaves the server through /api/people
export type DirectoryFieldPolicy =
  | { shown: "always" }
  | { shown: "setting"; setting: DirectoryToggleableField }
  | { shown: "never"; why: string };

export const DIRECTORY_FIELD_POLICY: Record<string, DirectoryFieldPolicy> = {
  // Employee
  "Employee.id": { shown: "always" },
  "Employee.employeeCode": { shown: "always" },
  "Employee.officialEmail": { shown: "setting", setting: "officialEmail" },
  "Employee.dateOfJoining": { shown: "setting", setting: "dateOfJoining" },
  "Employee.lastWorkingDate": { shown: "never", why: "separation detail — HR only" },
  "Employee.exitReason": { shown: "never", why: "why someone left — HR only (Leavers report, reports.view in scope)" },
  "Employee.employmentType": { shown: "never", why: "contract/probation status is HR data" },
  "Employee.status": { shown: "never", why: "used only to filter to ACTIVE employees" },
  "Employee.createdAt": { shown: "never", why: "internal bookkeeping" },
  "Employee.updatedAt": { shown: "never", why: "internal bookkeeping" },

  // EmployeePersonal
  "EmployeePersonal.id": { shown: "never", why: "internal id" },
  "EmployeePersonal.employeeId": { shown: "never", why: "same as Employee.id" },
  "EmployeePersonal.dateOfBirth": { shown: "setting", setting: "birthday" }, // day + month only, never the year
  "EmployeePersonal.gender": { shown: "never", why: "personal data, not needed to find a colleague" },
  // PEEPS-BEGIN directory-contact
  "EmployeePersonal.personalEmail": { shown: "never", why: "personal contact detail: never in the directory (owner decision, Peeps avatars and directory)" },
  // PEEPS-END
  "EmployeePersonal.mobile": { shown: "setting", setting: "mobile" },
  "EmployeePersonal.currentAddress": { shown: "never", why: "home address" },
  "EmployeePersonal.permanentAddress": { shown: "never", why: "home address" },
  "EmployeePersonal.emergencyContactName": { shown: "never", why: "third-party personal data" },
  "EmployeePersonal.emergencyContactPhone": { shown: "never", why: "third-party personal data" },
  "EmployeePersonal.emergencyContactRelation": { shown: "never", why: "third-party personal data" },
  "EmployeePersonal.bloodGroup": { shown: "never", why: "health data" },
  "EmployeePersonal.photoStorageKey": { shown: "never", why: "internal storage key — clients use photoVersion + the photo endpoint" },
  "EmployeePersonal.photoThumbStorageKey": { shown: "never", why: "internal storage key — clients use photoVersion + the photo endpoint" },
  "EmployeePersonal.photoVersion": { shown: "always" },
  "EmployeePersonal.createdAt": { shown: "never", why: "internal bookkeeping" },
  "EmployeePersonal.updatedAt": { shown: "never", why: "internal bookkeeping" },
};

export const DIRECTORY_POLICY_MODELS = ["Employee", "EmployeePersonal"] as const;
