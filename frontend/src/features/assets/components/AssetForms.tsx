import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Form, Input, Select } from "antd";
import type { AssetSettingItem } from "@shared/constants/assets";
import { SideDrawer, useDebouncedValue } from "../../../ui";
import * as assetsApi from "../api";
import type { AssetDetail } from "../api";
import type { ActionValues, AssetAction, Lists } from "../helpers";

// The forms behind every register action, one drawer each. The server validates every code against the confirmed lists and refuses anything else;
// these forms only offer what it will accept.

const opts = (items: AssetSettingItem[]) => items.map((i) => ({ value: i.code, label: i.label }));

/** Active people in the viewer's data scope, searched on the server. */
function HolderSelect({ value, onChange, exclude, id }: { value?: string; onChange?: (v: string) => void; exclude?: string; id?: string }) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search, 250);
  const { data = [], isFetching } = useQuery({ queryKey: ["assets", "holders", q], queryFn: () => assetsApi.searchHolders(q) });
  return (
    <Select
      id={id}
      showSearch={{ filterOption: false, onSearch: setSearch }}
      placeholder="Search by name or employee code"
      loading={isFetching}
      value={value}
      onChange={onChange}
      notFoundContent={isFetching ? "Searching…" : "No active employee matches"}
      options={data.filter((p) => p.employeeId !== exclude).map((p) => ({ value: p.employeeId, label: `${p.name} (${p.employeeCode})` }))}
    />
  );
}

const TITLES: Record<AssetAction, string> = {
  create: "Add an asset",
  edit: "Edit asset details",
  issue: "Issue asset",
  return: "Take asset back",
  transfer: "Transfer asset",
  lost: "Report asset lost",
  damaged: "Record damage",
};
const PRIMARY: Record<AssetAction, string> = { create: "Add asset", edit: "Save", issue: "Issue", return: "Record return", transfer: "Transfer", lost: "Report lost", damaged: "Record damage" };

export function AssetActionDrawer({
  action,
  asset,
  lists,
  loading,
  onClose,
  onSubmit,
}: {
  action: AssetAction | null;
  asset: AssetDetail | null;
  lists: Lists;
  loading: boolean;
  onClose: () => void;
  onSubmit: (values: ActionValues) => void;
}) {
  const [form] = Form.useForm<ActionValues>();
  const formId = "asset-action-form";
  const notIssuable = lists.statuses.filter((s) => !s.issuable);
  const initial: ActionValues =
    action === "edit" && asset
      ? { name: asset.name, categoryCode: asset.category.code, statusCode: asset.status.code, serialNumber: asset.serialNumber ?? "", model: asset.model ?? "", notes: asset.notes ?? "" }
      : {};
  const holderName = asset?.holder && !("hidden" in asset.holder) ? asset.holder.name : null;

  return (
    <SideDrawer
      open={action !== null}
      onClose={onClose}
      title={action ? TITLES[action] : ""}
      subtitle={asset && action !== "create" ? `${asset.assetId} · ${asset.name}${holderName && action !== "issue" ? ` · with ${holderName}` : ""}` : undefined}
      formId={formId}
      primaryLabel={action ? PRIMARY[action] : undefined}
      primaryLoading={loading}
      primaryDanger={action === "lost"}
      destroyOnHidden
    >
      {action && (
        <Form id={formId} form={form} layout="vertical" requiredMark initialValues={initial} onFinish={onSubmit} key={`${action}:${asset?.id ?? "new"}`}>
          {(action === "create" || action === "edit") && (
            <>
              <Form.Item name="name" label="Name" rules={[{ required: true, max: 120 }]}>
                <Input placeholder="What it is, as people call it" />
              </Form.Item>
              <Form.Item name="categoryCode" label="Category" rules={[{ required: true }]}>
                <Select options={opts(lists.categories)} placeholder="Choose a category" />
              </Form.Item>
              <Form.Item name="statusCode" label="Status" rules={[{ required: true }]} extra="Only a status that allows issuing lets the asset be issued.">
                <Select options={lists.statuses.map((s) => ({ value: s.code, label: `${s.label}${s.issuable ? "" : " (cannot be issued)"}` }))} placeholder="Choose a status" />
              </Form.Item>
              <Form.Item name="serialNumber" label="Serial number" rules={[{ max: 120 }]}>
                <Input />
              </Form.Item>
              <Form.Item name="model" label="Model" rules={[{ max: 120 }]}>
                <Input />
              </Form.Item>
              <Form.Item name="notes" label="Notes" rules={[{ max: 1000 }]}>
                <Input.TextArea rows={3} />
              </Form.Item>
            </>
          )}
          {action === "issue" && (
            <Form.Item name="employeeId" label="Issue to" rules={[{ required: true, message: "Choose who receives it." }]}>
              <HolderSelect />
            </Form.Item>
          )}
          {action === "transfer" && (
            <Form.Item name="toEmployeeId" label="Transfer to" rules={[{ required: true, message: "Choose who receives it." }]} extra="The current holder's assignment ends and the new holder is asked to acknowledge receipt.">
              <HolderSelect exclude={asset?.holder && !("hidden" in asset.holder) ? asset.holder.employeeId : undefined} />
            </Form.Item>
          )}
          {(action === "issue" || action === "transfer" || action === "return" || action === "damaged") && (
            <Form.Item name="conditionCode" label={action === "return" ? "Condition on return" : action === "damaged" ? "Condition now" : "Condition at hand-over"} rules={[{ required: true }]}>
              <Select options={opts(lists.conditions)} placeholder="Choose a condition" />
            </Form.Item>
          )}
          {action === "return" && (
            <Form.Item name="statusCode" label="Status after return" extra="Leave empty to keep the current status.">
              <Select allowClear options={opts(lists.statuses)} placeholder={asset?.status.label} />
            </Form.Item>
          )}
          {action === "damaged" && (
            <Form.Item name="statusCode" label="Change status to" extra="Optional, for example while it is being repaired.">
              <Select allowClear options={opts(lists.statuses)} placeholder={asset?.status.label} />
            </Form.Item>
          )}
          {action === "lost" && (
            <Form.Item name="statusCode" label="Status" rules={[{ required: true }]} extra="A lost asset takes a status that cannot be issued. Only the event is recorded: nothing is deducted from anyone.">
              <Select options={opts(notIssuable)} placeholder={notIssuable.length ? "Choose a status" : "No status that blocks issuing is set up"} />
            </Form.Item>
          )}
          {action !== "create" && action !== "edit" && (
            <Form.Item
              name="note"
              label={action === "lost" || action === "damaged" ? "What happened" : "Note"}
              rules={action === "lost" || action === "damaged" ? [{ required: true, min: 3, max: 1000 }] : [{ max: 1000 }]}
            >
              <Input.TextArea rows={3} />
            </Form.Item>
          )}
        </Form>
      )}
    </SideDrawer>
  );
}
