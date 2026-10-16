import { Alert } from "antd";
import { Link } from "react-router-dom";
import type { Watermark } from "../../api/payroll";

// The on-screen half of the "TEST — placeholder rules" watermark (docs/plans/PHASE_6.md §1): shown at the top of every payroll screen that touches a
// run which used a Placeholder. The same text is carried by the workbooks and the payslip previews the backend produces.
export function PlaceholderBanner({ watermark }: { watermark: Watermark | null | undefined }) {
  if (!watermark?.test) return null;
  return (
    <Alert
      type="error"
      showIcon
      banner
      title={`${watermark.text}. This is a test: it cannot be approved, finalised, published or turned into a bank file.`}
      description={
        <>
          Still a Placeholder: {watermark.rules.map((r, i) => (<span key={r.key}>{i > 0 && "; "}<Link to="/admin/payroll/rules">{r.label}</Link></span>))}. A different person has to confirm each one.
        </>
      }
    />
  );
}
