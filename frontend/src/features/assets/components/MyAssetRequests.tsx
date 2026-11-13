import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { DataTable, EmptyState, Panel, SideDrawer, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";
import * as req from "../requestsApi";
import type { AssetRequestView } from "../requestsApi";

const FORM = "asset-request-form";

// My Assets → Requests (Peeps Stage 3): ask for an asset type; see your own requests and their status; cancel one that is still waiting. Nobody
// else's requests ever reach this panel.
export function MyAssetRequests() {
  const queryClient = useQueryClient();
  const opts = useQuery({ queryKey: ["assets", "request-options"], queryFn: req.options });
  const list = useQuery({ queryKey: ["assets", "requests", "mine"], queryFn: req.mine });
  const [key, setKey] = useState<string | null>(null);
  const [form] = Form.useForm<{ categoryCode: string; note?: string }>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["assets", "requests"] });
  const create = useMutation({
    mutationFn: (v: { categoryCode: string; note?: string }) => req.create({ ...v, idempotencyKey: key! }),
    onSuccess: () => { setKey(null); form.resetFields(); refresh(); toast.success("Request sent to HR and the directors."); },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't send the request.")),
  });
  const cancel = useMutation({
    mutationFn: req.cancel,
    onSuccess: () => { refresh(); toast.success("Request cancelled."); },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't cancel the request.")),
  });
  const state = (r: AssetRequestView) => <StatusChip tone={req.STATUS_TONE[r.status]}>{req.STATUS_LABEL[r.status]}</StatusChip>;
  const action = (r: AssetRequestView) => (r.status === "SUBMITTED" ? <Button size="small" loading={cancel.isPending && cancel.variables === r.id} onClick={() => cancel.mutate(r.id)}>Cancel</Button> : null);
  const ready = opts.data?.ready ?? false;
  return (
    <>
      <Panel
        title="My requests"
        subtitle="Ask for equipment; HR and the directors decide"
        extra={<Button icon={<PlusOutlined />} disabled={!ready} onClick={() => setKey(req.newKey())}>Ask for an asset</Button>}
      >
        <DataTable<AssetRequestView>
          rowKey="id"
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          dataSource={list.data ?? []}
          pagination={false}
          empty={<EmptyState title="No requests" description={opts.data && !ready ? "Asset types are Not set yet, so requests cannot be made." : null} compact illustration={false} />}
          columns={[
            { title: "Asset type", dataIndex: "category" },
            { title: "Asked", dataIndex: "requestedAt", render: (d: string) => formatDate(d) },
            { title: "Note from HR", dataIndex: "decisionNote", render: (n: string | null) => n ?? "" },
            { title: "", key: "s", align: "right", render: (_: unknown, r) => <span style={{ display: "inline-flex", gap: space[2], alignItems: "center" }}>{state(r)}{action(r)}</span> },
          ]}
          mobile={{ title: (r) => r.category, subtitle: (r) => formatDate(r.requestedAt), status: state, actions: action }}
        />
      </Panel>
      <SideDrawer open={key !== null} onClose={() => setKey(null)} title="Ask for an asset" formId={FORM} primaryLabel="Send request" primaryLoading={create.isPending}>
        <Form id={FORM} form={form} layout="vertical" requiredMark onFinish={(v) => create.mutate(v)}>
          <Form.Item name="categoryCode" label="Asset type" rules={[{ required: true, message: "Choose an asset type." }]}>
            <Select options={(opts.data?.categories ?? []).map((c) => ({ value: c.code, label: c.label }))} />
          </Form.Item>
          <Form.Item name="note" label="Note (optional)" rules={[{ max: 300 }]}>
            <Input.TextArea rows={2} maxLength={300} showCount />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
