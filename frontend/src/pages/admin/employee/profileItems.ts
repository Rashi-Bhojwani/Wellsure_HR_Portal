import type * as employeeApi from "../../../api/employee";
import type { KeyValueItem } from "../../../ui";

// Plain label/value builders for the employee profile (kept out of ProfileLayout.tsx so that file only exports components — fast refresh).

/** Masked statutory values — last 4 only, exactly as before; `revealed` (from the audited Reveal) replaces them. */
export function statutoryItems(
  s: NonNullable<employeeApi.EmployeeProfile["statutory"]>,
  revealed?: { pan: string | null; aadhaar: string | null; uan: string | null; esiNumber: string | null } | null,
): KeyValueItem[] {
  return [
    { label: "PAN", value: revealed?.pan ?? (s.hasPan ? `••••${s.panLast4}` : "—") },
    { label: "Aadhaar", value: revealed?.aadhaar ?? (s.hasAadhaar ? `••••${s.aadhaarLast4}` : "—") },
    { label: "UAN", value: revealed?.uan ?? (s.hasUan ? `••••${s.uanLast4}` : "—") },
    { label: "ESI Number", value: revealed?.esiNumber ?? (s.hasEsi ? `••••${s.esiLast4}` : "—") },
  ];
}

export function personalSections(p: NonNullable<employeeApi.EmployeeProfile["personal"]>) {
  return {
    info: [
      { label: "Date of Birth", value: p.dateOfBirth },
      { label: "Gender", value: p.gender },
      { label: "Personal Email", value: p.personalEmail },
      { label: "Mobile", value: p.mobile },
      { label: "Blood Group", value: p.bloodGroup ?? "—" },
    ] as KeyValueItem[],
    address: [
      { label: "Current Address", value: p.currentAddress, wide: true },
      { label: "Permanent Address", value: p.permanentAddress, wide: true },
    ] as KeyValueItem[],
    emergency: [
      { label: "Emergency Contact", value: `${p.emergencyContactName} (${p.emergencyContactRelation})` },
      { label: "Emergency Phone", value: p.emergencyContactPhone },
    ] as KeyValueItem[],
  };
}
