import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { ASSET_SETTING_LABELS } from "@shared/constants/assets";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, FilterBar, PageHeader, Panel, Stack, StatusChip, toast, useIsPhone } from "../../../ui";
import * as assetsApi from "../api";
import type { AssetDetail, AssetSummary } from "../api";
import { AssetActionDrawer } from "../components/AssetForms";
import { AssetDetailDrawer } from "../components/AssetDetailDrawer";
import { bodyFor, holderText, type ActionValues, type AssetAction } from "../helpers";
import { useAssetsRealtime } from "../useAssetsRealtime";

const PAGE_SIZE = 50;
const DONE: Record<AssetAction, string> = { create: "Asset added.", edit: "Details saved.", issue: "Asset issued. The holder has been asked to acknowledge it.", return: "Return recorded.", transfer: "Asset transferred.", lost: "Loss recorded.", damaged: "Damage recorded." };

// Assets → Asset Register (Peeps module 1). HR manages it (assets.manage); directors see everything. Until the categories, statuses and conditions are
// entered and confirmed by a director, the page says so and offers no way to add or issue anything (the server refuses too).
export function AssetRegisterPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("assets.manage");
  const canSettings = hasPermission("assets.settings.manage");
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  useAssetsRealtime();
  const [params, setParams] = useSearchParams();
  const openId = params.get("asset");
  const [q, setQ] = useState("");
  const [categoryCode, setCategoryCode] = useState<string>();
  const [statusCode, setStatusCode] = useState<string>();
  const [holder, setHolder] = useState<"any" | "assigned" | "unassigned">("any");
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<{ kind: AssetAction; asset: AssetDetail | null } | null>(null);

  const lists = useQuery({ queryKey: ["assets", "lists"], queryFn: assetsApi.getLists });
  const query = { q: q || undefined, categoryCode, statusCode, holder, page, pageSize: PAGE_SIZE };
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ["assets", "list", query], queryFn: () => assetsApi.listAssets(query), placeholderData: (prev) => prev });
  const ready = lists.data?.ready ?? false;

  const openAsset = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("asset", id);
    else next.delete("asset");
    setParams(next, { replace: true });
  };

  const run = useMutation({
    mutationFn: async ({ kind, asset, values }: { kind: AssetAction; asset: AssetDetail | null; values: ActionValues }) => {
      const body = bodyFor(kind, values, asset) as never;
      switch (kind) {
        case "create":
          return assetsApi.createAsset(body);
        case "edit":
          return assetsApi.updateAsset(asset!.id, body);
        case "issue":
          return assetsApi.issueAsset(asset!.id, body);
        case "return":
          return assetsApi.returnAsset(asset!.id, body);
        case "transfer":
          return assetsApi.transferAsset(asset!.id, body);
        case "lost":
          return assetsApi.markLost(asset!.id, body);
        case "damaged":
          return assetsApi.markDamaged(asset!.id, body);
      }
    },
    onSuccess: (result, { kind }) => {
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      setAction(null);
      toast.success(DONE[kind]);
      if (kind === "create") openAsset(result.id);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "That didn't work.")),
  });

  const addButton = canManage && ready && (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setAction({ kind: "create", asset: null })}>
      Add asset
    </Button>
  );
  const missingNames = (lists.data?.missing ?? []).map((k) => ASSET_SETTING_LABELS[k].label.toLowerCase()).join(", ");
  const activeFilters = [categoryCode, statusCode, holder !== "any" ? holder : undefined].filter(Boolean).length;

  return (
    <>
      <PageHeader title="Asset Register" subtitle="Company equipment, who holds it, and everything that happened to it" actions={addButton || undefined} />
      <Stack>
        {lists.data && !ready && (
          <ApprovalBanner
            tone="warning"
            title="The asset register is not set up yet"
            description={`Not set: ${missingNames}. HR Admin enters each list and a director who did not enter it confirms it. Until then no asset can be added or issued.`}
            actions={canSettings ? <Link to="/admin/assets/settings">Open asset settings</Link> : undefined}
          />
        )}
        <Panel title="Assets" subtitle={data ? `${data.total} asset${data.total === 1 ? "" : "s"}` : undefined}>
          <FilterBar
            searchPlaceholder="Search by name, asset ID, serial, model or holder"
            onSearch={(val) => {
              setQ(val);
              setPage(1);
            }}
            activeCount={activeFilters}
            onClear={() => {
              setCategoryCode(undefined);
              setStatusCode(undefined);
              setHolder("any");
              setPage(1);
            }}
            filters={
              <>
                <Select
                  allowClear
                  aria-label="Category"
                  placeholder="Category"
                  style={{ width: phone ? "100%" : 180 }}
                  value={categoryCode}
                  onChange={(x) => {
                    setCategoryCode(x);
                    setPage(1);
                  }}
                  options={(lists.data?.categories ?? []).map((c) => ({ value: c.code, label: c.label }))}
                />
                <Select
                  allowClear
                  aria-label="Status"
                  placeholder="Status"
                  style={{ width: phone ? "100%" : 180 }}
                  value={statusCode}
                  onChange={(x) => {
                    setStatusCode(x);
                    setPage(1);
                  }}
                  options={(lists.data?.statuses ?? []).map((c) => ({ value: c.code, label: c.label }))}
                />
                <Select
                  aria-label="Holder"
                  style={{ width: phone ? "100%" : 180 }}
                  value={holder}
                  onChange={(x) => {
                    setHolder(x);
                    setPage(1);
                  }}
                  options={[
                    { value: "any", label: "Issued or not" },
                    { value: "assigned", label: "Issued" },
                    { value: "unassigned", label: "Not issued" },
                  ]}
                />
              </>
            }
          />
          <DataTable<AssetSummary>
            rowKey="id"
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.items ?? []}
            onRowOpen={(a) => openAsset(a.id)}
            pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
            showTotal
            empty={
              <EmptyState
                illustration="inbox"
                title={q || activeFilters ? "No asset matches" : "No assets yet"}
                description={q || activeFilters ? "Try another search or clear the filters." : ready ? "Add the first asset to start the register." : "The register opens once its settings are confirmed."}
                action={!q && !activeFilters ? addButton || undefined : undefined}
                compact
              />
            }
            columns={[
              {
                title: "Asset",
                key: "name",
                render: (_: unknown, a) => (
                  <div>
                    <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{a.name}</div>
                    <div style={{ color: v.textSecondary, fontSize: fs.sm }}>
                      {a.assetId}
                      {a.serialNumber ? ` · ${a.serialNumber}` : ""}
                    </div>
                  </div>
                ),
              },
              { title: "Category", key: "category", render: (_: unknown, a) => a.category.label },
              { title: "Status", key: "status", render: (_: unknown, a) => <StatusChip tone={a.status.issuable ? "success" : "neutral"}>{a.status.label}</StatusChip> },
              { title: "Held by", key: "holder", render: (_: unknown, a) => holderText(a.holder) },
              {
                title: "Receipt",
                key: "ack",
                render: (_: unknown, a) => (a.acknowledged === null ? "—" : a.acknowledged ? <StatusChip tone="success">Acknowledged</StatusChip> : <StatusChip tone="warning">Waiting</StatusChip>),
              },
              {
                title: "",
                key: "open",
                align: "right",
                render: (_: unknown, a) => (
                  <Button type="link" onClick={() => openAsset(a.id)} aria-label={`Open ${a.name}`}>
                    Open
                  </Button>
                ),
              },
            ]}
            mobile={{
              title: (a) => a.name,
              subtitle: (a) => `${a.assetId} · ${a.category.label}`,
              status: (a) => <StatusChip tone={a.status.issuable ? "success" : "neutral"}>{a.status.label}</StatusChip>,
              fields: [
                { label: "Held by", render: (a) => holderText(a.holder) },
                { label: "Receipt", render: (a) => (a.acknowledged === null ? "—" : a.acknowledged ? "Acknowledged" : "Waiting") },
              ],
              actions: (a) => (
                <Button onClick={() => openAsset(a.id)} aria-label={`Open ${a.name}`}>
                  Open
                </Button>
              ),
            }}
          />
        </Panel>
      </Stack>
      <AssetDetailDrawer assetId={action ? null : openId} canManage={canManage} ready={ready} onClose={() => openAsset(null)} onAction={(kind, asset) => setAction({ kind, asset })} />
      <AssetActionDrawer
        action={action?.kind ?? null}
        asset={action?.asset ?? null}
        lists={{ categories: lists.data?.categories ?? [], statuses: lists.data?.statuses ?? [], conditions: lists.data?.conditions ?? [] }}
        loading={run.isPending}
        onClose={() => setAction(null)}
        onSubmit={(values) => action && run.mutate({ kind: action.kind, asset: action.asset, values })}
      />
    </>
  );
}
