import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Form, Input, Select } from "antd";
import { useNavigate } from "react-router-dom";
import * as api from "../../api/helpdesk";
import { apiErrorMessage } from "../../lib/apiError";
import { ApprovalBanner, EmptyState, QueryState, SideDrawer, Stack, toast } from "../../ui";

export function MoveTicketDrawer({ ticket, onClose }: { ticket: api.HelpdeskTicket; onClose: () => void }) {
  const [key] = useState(() => crypto.randomUUID());
  const client = useQueryClient();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ["helpdesk", "categories", "all"], queryFn: api.listAllCategories });
  const targets = query.data?.filter((c) => c.id !== ticket.category.id && c.code !== "PAYROLL_SALARY" && c.isActive);
  const move = useMutation({
    mutationFn: (values: { targetCategoryId: string; reason: string }) => api.moveTicket(ticket.id, { ...values, idempotencyKey: key }),
    onSuccess: () => {
      // The move may remove access. Clear the old thread before navigating.
      client.removeQueries({ queryKey: ["helpdesk", "ticket", ticket.id] });
      void client.invalidateQueries({ queryKey: ["helpdesk"] });
      void client.resetQueries({ queryKey: ["notifications"] });
      void client.resetQueries({ queryKey: ["tasks"] });
      toast.success("Ticket moved to another team.");
      onClose();
      navigate("/admin/employee/helpdesk");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't move the ticket.")),
  });
  return <SideDrawer open onClose={onClose} title="Move ticket" subtitle={ticket.number} formId="helpdesk-move-form" primaryLabel="Move" primaryLoading={move.isPending} primaryDisabled={!targets?.length || !!query.error}>
    <QueryState isLoading={query.isLoading} error={query.error} onRetry={() => void query.refetch()} isEmpty={targets?.length === 0} empty={<EmptyState title="No other general categories" description="A director can create and set up another category." />}>
      <Stack>
        <ApprovalBanner tone="warning" title="Your access may end" description="If the new team is outside your visibility, you lose access immediately. The employee keeps the thread and receives a neutral move notice." />
        <Form id="helpdesk-move-form" layout="vertical" onFinish={(values) => move.mutate(values)}>
          <Form.Item name="targetCategoryId" label="New category" rules={[{ required: true }]}>
            <Select showSearch={{ optionFilterProp: "label" }} options={targets?.map((c) => ({ value: c.id, label: `${c.name}${c.visibilityState === "NOT_SET" ? " · Not set" : ""}`, disabled: c.visibilityState === "NOT_SET" }))} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true, whitespace: true }]} extra="Kept in the audit history; the employee receives only the neutral system note.">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Stack>
    </QueryState>
  </SideDrawer>;
}
