import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { MailOutlined } from "@ant-design/icons";
import type { ReportKey } from "@shared/constants/reports";
import * as reportsApi from "../../../api/reports";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, space, v } from "../../../theme/tokens";
import { ConfirmModal, StatusChip, toast } from "../../../ui";

// RP-13 (M session): "Email me this report". Weekly (Mondays: the last 7 days, or as of that day) or monthly (the 1st: the last calendar month).
// The email has the row count and a link to open the report here, never the rows. The org filters on screen are kept; dates are worked out each time.
export function EmailMeReport({ reportKey, query }: { reportKey: ReportKey; query: reportsApi.ReportQuery }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [frequency, setFrequency] = useState<"WEEKLY" | "MONTHLY">("WEEKLY");
  const subs = useQuery({ queryKey: ["report-subscriptions"], queryFn: reportsApi.mySubscriptions });
  const current = subs.data?.find((s) => s.reportKey === reportKey);
  const done = (data: reportsApi.ReportSubscription[], msg: string) => {
    queryClient.setQueryData(["report-subscriptions"], data);
    setOpen(false);
    toast.success(msg);
  };
  const filters = Object.fromEntries(Object.entries({ departmentId: query.departmentId, locationId: query.locationId, employmentType: query.employmentType, leaveTypeId: query.leaveTypeId, kind: query.kind }).filter(([, val]) => val)) as Record<string, string>;
  const save = useMutation({ mutationFn: () => reportsApi.subscribe(reportKey, frequency, filters), onSuccess: (d) => done(d, "Scheduled. You get an email with a link, never the rows."), onError: (e) => toast.error(apiErrorMessage(e, "Could not schedule it.")) });
  const remove = useMutation({ mutationFn: () => reportsApi.unsubscribe(current!.id), onSuccess: (d) => done(d, "The schedule is removed."), onError: (e) => toast.error(apiErrorMessage(e, "Could not remove it.")) });
  return (
    <>
      <Button size="large" icon={<MailOutlined />} onClick={() => { setFrequency(current?.frequency ?? "WEEKLY"); setOpen(true); }}>
        {current?.active ? (current.frequency === "WEEKLY" ? "Emailed weekly" : "Emailed monthly") : "Email me this report"}
      </Button>
      <ConfirmModal
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => save.mutate()}
        loading={save.isPending}
        title="Email me this report"
        confirmLabel={current ? "Save" : "Schedule"}
        description="You get an email with the number of rows and a link to open the report here. The rows themselves are never emailed. The filters on screen are kept; the dates are worked out each time."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
          <Select aria-label="How often" value={frequency} onChange={setFrequency} options={[{ value: "WEEKLY", label: "Weekly, on Mondays" }, { value: "MONTHLY", label: "Monthly, on the 1st" }]} />
          {current && !current.active && <span style={{ color: v.textSecondary, fontSize: fs.sm }}><StatusChip tone="warning">Stopped</StatusChip> {current.stoppedWhy}</span>}
          {current && <Button danger onClick={() => remove.mutate()} loading={remove.isPending}>Stop emailing it</Button>}
        </div>
      </ConfirmModal>
    </>
  );
}
