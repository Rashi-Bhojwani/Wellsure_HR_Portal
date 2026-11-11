import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { financialYearOf } from "@shared/utils/financialYear";
import * as taxApi from "../../../api/tax";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, KeyValueGrid, PageHeader, Panel, SkeletonCard, Stack } from "../../../ui";

// Salary > Form 16 (P7-7): the person's own Form 16 Part B data for a finished year, marked DRAFT until confirmed. Part A comes from the tax department's portal.
function years(): string[] {
  const now = Number(financialYearOf(new Date().toISOString().slice(0, 10)).label.slice(0, 4));
  return [now - 3, now - 2, now - 1].map((y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`);
}

export function Form16Page() {
  const [fy, setFy] = useState(years()[2]!);
  const q = useQuery({ queryKey: ["tax", "form16", fy], queryFn: () => taxApi.myForm16(fy), retry: false });
  const f = q.data;
  return (
    <>
      <PageHeader title="Form 16" subtitle="Your salary and tax for a finished financial year" actions={<Select aria-label="Financial year" value={fy} onChange={setFy} options={years().map((y) => ({ value: y, label: y }))} style={{ minWidth: 120 }} />} />
      <Stack>
        {q.isLoading && <SkeletonCard lines={4} />}
        {q.error && <ApprovalBanner tone="info" title="Not available" description={apiErrorMessage(q.error, "Try another year.")} />}
        {f && (
          <>
            {f.watermark && <ApprovalBanner tone="warning" title="DRAFT" description={f.watermark} />}
            <Panel title={`Part B, ${f.year}`} subtitle={f.partA}>
              <KeyValueGrid
                items={[
                  { key: "r", label: "Regime", value: f.regime ?? "Not chosen" },
                  { key: "t", label: "Taxable pay", value: formatRupees(f.taxablePay, 2) },
                  { key: "a", label: "Tax for the year", value: f.computation?.annualTax ? formatRupees(f.computation.annualTax, 2) : "—" },
                  { key: "d", label: "TDS deducted", value: formatRupees(f.tdsDeducted, 2) },
                ]}
              />
            </Panel>
          </>
        )}
      </Stack>
    </>
  );
}
