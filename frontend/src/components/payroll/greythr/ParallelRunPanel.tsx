import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, Switch } from "antd";
import { DeleteOutlined, DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import * as api from "../../../api/greythr";
import type { CompareLine, ComparePerson, Comparison, ComparisonRow } from "../../../api/greythr";
import { saveBlob } from "../../../api/muster";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { Dropzone } from "../../../pages/admin/import/Dropzone";
import { space } from "../../../theme/tokens";
import { ApprovalBanner, CardGrid, ConfirmModal, DataTable, Panel, Stack, StatCard, StatusChip, toast } from "../../../ui";

// Stage 8 (docs/plans/STAGE_8_PLAN.md, IE-12, PY-32): the parallel-run kit, directors only. greytHR's salary statement against the portal's run for the same month.
// The kit reads; it changes no payroll data. Every figure comes from the server; the screen only lays it out. A "likely cause" appears only where the data proves it.

type DiffRow = CompareLine & { code: string; side: ComparePerson["side"]; personHint: string | null; key: string };
const money = (v: string | null, kind: CompareLine["kind"]) => (v === null ? "—" : kind === "DAYS" ? v : formatRupees(v, 2));
const SIDE = { BOTH: "Both", GREYTHR_ONLY: "greytHR only", PORTAL_ONLY: "Portal only" } as const;

export function ParallelRunPanel() {
  const qc = useQueryClient();
  const [runId, setRunId] = useState<string>();
  const [current, setCurrent] = useState<Comparison | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [showMatches, setShowMatches] = useState(false);
  const [deleting, setDeleting] = useState<ComparisonRow | null>(null);
  const runs = useQuery({ queryKey: ["greythr", "runs"], queryFn: api.comparableRuns });
  const list = useQuery({ queryKey: ["greythr", "comparisons"], queryFn: api.listComparisons });
  const open = (c: Comparison) => {
    setCurrent(c);
    setMapping(c.mapping);
  };
  const fail = (what: string) => (err: unknown) => toast.error(apiErrorMessage(err, what));
  const compare = useMutation({ mutationFn: (file: File) => api.compare(runId!, file), onSuccess: (c) => { open(c); toast.success("Compared. Nothing in payroll changed."); void qc.invalidateQueries({ queryKey: ["greythr", "comparisons"] }); }, onError: fail("Could not compare.") });
  const recompare = useMutation({ mutationFn: () => api.recompare(current!.id, mapping), onSuccess: (c) => { open(c); toast.success("Compared again with this mapping."); void qc.invalidateQueries({ queryKey: ["greythr", "comparisons"] }); }, onError: fail("Could not compare again.") });
  const load = useMutation({ mutationFn: api.getComparison, onSuccess: open, onError: fail("Could not open it.") });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteComparison(id), onSuccess: (_, id) => { if (current?.id === id) setCurrent(null); setDeleting(null); toast.success("Deleted."); void qc.invalidateQueries({ queryKey: ["greythr", "comparisons"] }); }, onError: fail("Could not delete it.") });
  const download = async (format: "xlsx" | "csv") => {
    try {
      saveBlob(await api.exportComparison(current!.id, format), `parallel-run-${current!.run.cycleStart.slice(0, 7)}.${format}`);
    } catch (err) {
      fail("Could not export.")(err);
    }
  };
  const rows: DiffRow[] = useMemo(
    () => (current?.result.people ?? []).flatMap((p) => p.lines.filter((l) => showMatches || !l.matched).map((l, i) => ({ ...l, code: p.code, side: p.side, personHint: p.hint, key: `${p.code}|${l.item}|${i}` }))),
    [current, showMatches],
  );
  const tolerance = list.data?.tolerance;
  const r = current?.result;

  return (
    <Stack>
      <Panel title="Compare a month" subtitle="Upload greytHR's salary statement for a month and choose the portal's run for the same month. The file is read and dropped; the comparison is saved, encrypted.">
        <Stack>
          {tolerance && (
            <div>
              <StatusChip tone={tolerance.isDefault ? "neutral" : "info"}>{tolerance.isDefault ? "Exact match (a difference of 0) · Default, change in settings" : `A match within ${formatRupees(tolerance.allowance, 2)}`}</StatusChip>
            </div>
          )}
          <Select
            aria-label="The portal's run"
            placeholder="The portal's run for the same month"
            style={{ width: "100%", maxWidth: 420 }}
            loading={runs.isLoading}
            value={runId}
            onChange={setRunId}
            options={(runs.data ?? []).map((x) => ({ value: x.id, label: `${x.label} · ${x.status === "FINALISED" ? "finalised" : "TEST, not finalised"}` }))}
            notFoundContent="No finalised or TEST run yet"
          />
          <Dropzone compact accept=".xls,.xlsx" disabled={!runId} loading={compare.isPending} onFile={(f) => compare.mutate(f)} title={runId ? "Drop greytHR's salary statement here" : "Choose the run first"} hint="greytHR's monthly Salary Statement (.xls or .xlsx), as exported. Bank account and IFSC columns are never read." buttonLabel="Upload the statement" />
        </Stack>
      </Panel>

      {current && r && (
        <>
          <Panel
            title={`${current.run.label}: greytHR against the portal`}
            subtitle={`${current.fileName} · ${current.statement.people} people in the statement · allowance ${formatRupees(r.allowance, 2)}`}
            extra={
              <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                <Button icon={<DownloadOutlined />} onClick={() => void download("xlsx")}>Differences .xlsx</Button>
                <Button icon={<DownloadOutlined />} onClick={() => void download("csv")}>.csv</Button>
              </div>
            }
          >
            <Stack>
              {current.run.test && <ApprovalBanner tone="warning" title="TEST run" description="This run used placeholder rules; it is for checking only." />}
              <CardGrid min={150} gap={space[3]}>
                <StatCard variant="compact" tone="accent" label="Matched exactly" value={r.counts.matchedPeople} />
                <StatCard variant="compact" tone={r.counts.peopleWithDifferences ? "warning" : "neutral"} label="People with differences" value={r.counts.peopleWithDifferences} />
                <StatCard variant="compact" tone={r.counts.greythrOnly ? "warning" : "neutral"} label="In greytHR only" value={r.counts.greythrOnly} />
                <StatCard variant="compact" tone={r.counts.portalOnly ? "warning" : "neutral"} label="In the portal only" value={r.counts.portalOnly} />
                <StatCard variant="compact" label="Net difference (portal minus greytHR)" value={formatRupees(r.overallNetDifference, 2)} />
              </CardGrid>
              {r.heads.onlyInGreythr.length > 0 && <ApprovalBanner tone="info" title="Heads only in greytHR" description={`${r.heads.onlyInGreythr.join(", ")}. Choose a portal head for any of them below, or leave them as they are.`} />}
              {r.heads.onlyInPortal.length > 0 && <ApprovalBanner tone="info" title="Heads only in the portal" description={current.portalHeads.filter((h) => r.heads.onlyInPortal.includes(h.code)).map((h) => h.label).join(", ")} />}
              {current.statement.notCompared.length > 0 && <ApprovalBanner tone="info" title="Columns read but not compared" description={current.statement.notCompared.join(", ")} />}
            </Stack>
          </Panel>

          <Panel title="Which greytHR column compares with which portal head" subtitle="Matched by name where the names are the same; you choose the rest. Comparing again uses the saved statement.">
            <DataTable<{ header: string }>
              rowKey="header"
              density="compact"
              pagination={false}
              dataSource={current.statement.headColumns.map((header) => ({ header }))}
              mobile={{ title: (x) => x.header, fields: [{ label: "Portal head", render: (x) => headSelect(x.header) }] }}
              columns={[
                { title: "greytHR column", dataIndex: "header" },
                { title: "Portal head", key: "p", render: (_: unknown, x: { header: string }) => headSelect(x.header) },
              ]}
            />
            <div style={{ marginTop: space[3] }}>
              <Button type="primary" icon={<ReloadOutlined />} loading={recompare.isPending} onClick={() => recompare.mutate()}>Compare again</Button>
            </div>
          </Panel>

          <Panel title="Differences" subtitle="Portal minus greytHR. A likely cause is shown only where the data proves it." extra={<label style={{ display: "inline-flex", gap: space[2], alignItems: "center", minHeight: 44 }}><Switch checked={showMatches} onChange={setShowMatches} aria-label="Show matches too" />Show matches too</label>}>
            <DataTable<DiffRow>
              rowKey="key"
              density="compact"
              dataSource={rows}
              empty="No differences: every compared figure matches."
              pagination={{ pageSize: 50 }}
              scroll={{ x: "max-content" }}
              mobile={{ title: (x) => `${x.code} · ${x.item}`, subtitle: (x) => x.hint ?? x.personHint ?? "", status: (x) => <StatusChip tone={x.matched ? "success" : "warning"}>{x.matched ? "Matches" : "Differs"}</StatusChip>, fields: [{ label: "greytHR", render: (x: DiffRow) => money(x.greythr, x.kind) }, { label: "Portal", render: (x: DiffRow) => money(x.portal, x.kind) }, { label: "Difference", render: (x: DiffRow) => money(x.difference, x.kind) }] }}
              columns={[
                { title: "Employee number", dataIndex: "code" },
                { title: "In", key: "side", render: (_: unknown, x: DiffRow) => SIDE[x.side] },
                { title: "Item", dataIndex: "item" },
                { title: "greytHR", key: "g", align: "right" as const, render: (_: unknown, x: DiffRow) => money(x.greythr, x.kind) },
                { title: "Portal", key: "p", align: "right" as const, render: (_: unknown, x: DiffRow) => money(x.portal, x.kind) },
                { title: "Difference", key: "d", align: "right" as const, render: (_: unknown, x: DiffRow) => money(x.difference, x.kind) },
                { title: "Higher", key: "h", render: (_: unknown, x: DiffRow) => (x.higher === "PORTAL" ? "Portal" : x.higher === "GREYTHR" ? "greytHR" : "—") },
                { title: "Likely cause", key: "hint", render: (_: unknown, x: DiffRow) => x.hint ?? x.personHint ?? "" },
              ]}
            />
          </Panel>

          <Panel title="Totals per head">
            <DataTable<Comparison["result"]["totals"][number]>
              rowKey="item"
              density="compact"
              pagination={false}
              dataSource={r.totals}
              mobile={{ title: (t) => t.item, fields: [{ label: "greytHR", render: (t) => formatRupees(t.greythr, 2) }, { label: "Portal", render: (t) => formatRupees(t.portal, 2) }, { label: "Difference", render: (t) => formatRupees(t.difference, 2) }] }}
              columns={[
                { title: "Item", dataIndex: "item" },
                { title: "greytHR", dataIndex: "greythr", align: "right" as const, render: (v: string) => formatRupees(v, 2) },
                { title: "Portal", dataIndex: "portal", align: "right" as const, render: (v: string) => formatRupees(v, 2) },
                { title: "Difference", dataIndex: "difference", align: "right" as const, render: (v: string) => formatRupees(v, 2) },
              ]}
            />
          </Panel>
        </>
      )}

      <Panel title="Saved comparisons" subtitle={list.data?.retentionDays ? `Kept for ${list.data.retentionDays} days, then deleted.` : "Not set: kept until a director deletes them."}>
        <DataTable<ComparisonRow>
          rowKey="id"
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          dataSource={list.data?.comparisons ?? []}
          empty="No comparison saved yet."
          pagination={false}
          mobile={{ title: (c) => `${dayjs(`${c.month}-01`).format("MMM YYYY")} · ${c.fileName}`, subtitle: (c) => `${c.counts.matchedPeople} matched · ${c.counts.peopleWithDifferences} with differences`, actions: (c) => rowActions(c) }}
          columns={[
            { title: "Month", dataIndex: "month", render: (m: string) => dayjs(`${m}-01`).format("MMM YYYY") },
            { title: "File", dataIndex: "fileName" },
            { title: "Matched", key: "m", align: "right" as const, render: (_: unknown, c: ComparisonRow) => c.counts.matchedPeople },
            { title: "With differences", key: "d", align: "right" as const, render: (_: unknown, c: ComparisonRow) => c.counts.peopleWithDifferences },
            { title: "Compared", key: "at", render: (_: unknown, c: ComparisonRow) => `${dayjs(c.createdAt).format("D MMM YYYY HH:mm")} · ${c.by}` },
            { title: "", key: "a", fixed: "right" as const, render: (_: unknown, c: ComparisonRow) => rowActions(c) },
          ]}
        />
      </Panel>
      <ConfirmModal open={!!deleting} title="Delete this comparison?" description="It holds pay figures; deleting it cannot be undone. Payroll itself is not touched." confirmLabel="Delete" danger loading={remove.isPending} onCancel={() => setDeleting(null)} onConfirm={() => remove.mutate(deleting!.id)} />
    </Stack>
  );

  function headSelect(header: string) {
    return (
      <Select
        aria-label={`Portal head for ${header}`}
        style={{ width: "100%", minWidth: 200 }}
        value={mapping[header] ?? "__none"}
        onChange={(v: string) => setMapping((m) => ({ ...m, [header]: v === "__none" ? null : v }))}
        options={[{ value: "__none", label: "Not compared (only in greytHR)" }, ...(current?.portalHeads ?? []).map((h) => ({ value: h.code, label: h.label }))]}
      />
    );
  }
  function rowActions(c: ComparisonRow) {
    return (
      <div style={{ display: "flex", gap: space[2] }}>
        <Button onClick={() => load.mutate(c.id)}>Open</Button>
        <Button icon={<DeleteOutlined />} aria-label="Delete comparison" onClick={() => setDeleting(c)} />
      </div>
    );
  }
}
