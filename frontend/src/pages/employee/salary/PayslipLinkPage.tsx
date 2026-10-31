import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import * as payrollApi from "../../../api/payroll";
import { apiErrorMessage } from "../../../lib/apiError";
import { ApprovalBanner, PageHeader, Panel, SkeletonCard } from "../../../ui";

// The page a payslip email's link opens (inside the signed-in shell, so it needs a sign-in first). The server checks again that the link is this person's, unexpired and not
// revoked; anything wrong shows the same message. Nothing about the payslip is on this page: it sends the person on to it.
export function PayslipLinkPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["payslip-link", token], queryFn: () => payrollApi.openPayslipLink(token), retry: false, gcTime: 0 });
  useEffect(() => {
    if (q.data) navigate(`/app/salary/payslips?open=${q.data.payslipId}`, { replace: true });
  }, [q.data, navigate]);
  return (
    <>
      <PageHeader title="Your payslip" />
      <Panel>
        {q.isLoading || q.data ? (
          <SkeletonCard lines={2} />
        ) : (
          <>
            <ApprovalBanner tone="warning" title="This link is not valid" description={apiErrorMessage(q.error, "It may have expired, or it was not meant for you.")} />
            <div style={{ marginTop: 16 }}>
              <Button type="primary" size="large" onClick={() => navigate("/app/salary/payslips")}>Open my payslips</Button>
            </div>
          </>
        )}
      </Panel>
    </>
  );
}
