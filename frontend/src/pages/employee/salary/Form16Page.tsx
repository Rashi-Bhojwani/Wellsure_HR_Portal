import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { saveBlob } from "../../../api/muster";
import { financialYearOf } from "@shared/utils/financialYear";
import * as taxApi from "../../../api/tax";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { space } from "../../../theme/tokens";
import { ApprovalBanner, KeyValueGrid, PageHeader, Panel, SkeletonCard, Stack, toast } from "../../../ui";

// Salary > Form 16 (P7-7): the person's own Form 16 Part B data for a finished year, marked DRAFT until confirmed. Part A comes from the tax department's portal.
function years(): string[] {
  const now = Number(financialYearOf(new Date().toISOString().slice(0, 10)).label.slice(0, 4));
  return [now - 3, now - 2, now - 1].map((y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`);
}

export function Form16Page() {
  const [fy, setFy] = useState(years()[2]!);
  const q = useQuery({ queryKey: ["tax", "form16", fy], queryFn: () => taxApi.myForm16(fy), retry: false });
  const f = q.data;
  // SS-05 / ST-24: the PDF of the same Part B, marked DRAFT until confirmed.
  // ST-25: Part A as the tax portal issued it, once a director has uploaded it.
  const downloadPartA = async () => {
    try {
      saveBlob(await taxApi.myForm16PartA(fy), `form16-part-a-${fy}.pdf`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Part A is not available yet."));
    }
  };
  const download = async () => {
    try {
      saveBlob(await taxApi.myForm16Pdf(fy), `form16-part-b-${fy}${f?.draft ? "-DRAFT" : ""}.pdf`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not make the PDF."));
    }
  };
  return (
    <>
      <PageHeader title="Form 16" subtitle="Your salary and tax for a finished financial year" actions={<Select aria-label="Financial year" value={fy} onChange={setFy} options={years().map((y) => ({ value: y, label: y }))} style={{ minWidth: 120 }} />} />
      <Stack>
        {q.isLoading && <SkeletonCard lines={4} />}
        {q.error && <ApprovalBanner tone="info" title="Not available" description={apiErrorMessage(q.error, "Try another year.")} />}
        {f && (
          <>
            {f.watermark && <ApprovalBanner tone="warning" title="DRAFT" description={f.watermark} />}
            <Panel title={`Part B, ${f.year}`} subtitle={f.partA} extra={<div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}><Button icon={<DownloadOutlined />} onClick={() => void download()}>{f.draft ? "Download draft PDF" : "Download PDF"}</Button><Button icon={<DownloadOutlined />} onClick={() => void downloadPartA()}>Part A</Button></div>}>
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
