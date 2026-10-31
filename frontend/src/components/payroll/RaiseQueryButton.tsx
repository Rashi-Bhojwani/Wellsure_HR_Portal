import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { MessageOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import * as payrollApi from "../../api/payroll";
import { apiErrorMessage } from "../../lib/apiError";
import { ConfirmModal, toast } from "../../ui";
import { space } from "../../theme/tokens";

// "Raise a query" on a payslip: opens a ticket in the Payroll category, which only the directors see. The ticket names the month, never a figure.
export function RaiseQueryButton({ payslipId }: { payslipId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const raise = useMutation({
    mutationFn: () => payrollApi.raisePayslipQuery(payslipId, message.trim()),
    onSuccess: (r) => { toast.success("Sent to the directors. You can follow it in your tickets."); setOpen(false); setMessage(""); navigate(`/app/helpdesk/${r.ticketId}`); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not send it.")),
  });
  return (
    <>
      <Button icon={<MessageOutlined />} style={{ minHeight: 44, marginBottom: space[3] }} onClick={() => setOpen(true)}>Raise a query</Button>
      {open && (
        <ConfirmModal open title="Raise a query about this payslip" description="Only the directors see it. Say what you would like to ask; do not write your figures here, they can see the payslip." confirmLabel="Send" cancelLabel="Cancel" confirmDisabled={message.trim().length < 3} loading={raise.isPending} onCancel={() => setOpen(false)} onConfirm={() => raise.mutate()}>
          <Form layout="vertical" component="div" requiredMark={false}>
            <Form.Item htmlFor="pq-message" validateStatus={problem ? "error" : undefined} help={problem ?? undefined} style={{ marginBottom: 0 }}>
              <Input.TextArea id="pq-message" autoFocus rows={4} maxLength={1000} showCount value={message} onChange={(e) => { setMessage(e.target.value); setProblem(null); }} />
            </Form.Item>
          </Form>
        </ConfirmModal>
      )}
    </>
  );
}
