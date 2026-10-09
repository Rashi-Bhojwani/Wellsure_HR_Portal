import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Select, Space, Spin, Table, Tag, Typography, Upload, message } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import * as musterApi from "../../../../api/muster";
import type { MusterCycle, UploadPreview } from "../../../../api/muster";
import { apiErrorMessage } from "../../../../lib/apiError";

const { Text, Paragraph } = Typography;
const KIND: Record<string, { label: string; color?: string }> = { TIMED: { label: "times" }, STATUS_ONLY: { label: "status only" }, CLEARED: { label: "clears the day (back to NM)", color: "red" } };

/**
 * Muster upload (docs/plans/PHASE_2.md §5.2): the template for a branch and
 * cycle, then upload → preview → commit. Used on the muster page and in the
 * Import Center.
 */
export function MusterUploadPanel({ branches, cycles, defaultBranch, defaultCycle }: { branches: Array<{ id: string; name: string }>; cycles: MusterCycle[]; defaultBranch?: string; defaultCycle?: string }) {
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState<string | undefined>(defaultBranch ?? (branches.length === 1 ? branches[0]!.id : undefined));
  const [cycle, setCycle] = useState<string | undefined>(defaultCycle ?? cycles[0]?.start);
  const [preview, setPreview] = useState<UploadPreview | null>(null);

  const template = useMutation({
    mutationFn: () => musterApi.downloadTemplate({ locationId: branch!, cycleStart: cycle }),
    onSuccess: (blob) => musterApi.saveBlob(blob, `muster-${branches.find((b) => b.id === branch)?.name ?? "branch"}-${cycle}.xlsx`),
    onError: (err) => void message.error(apiErrorMessage(err, "Could not download the template.")),
  });
  const upload = useMutation({
    mutationFn: (file: File) => musterApi.previewUpload(file),
    onSuccess: setPreview,
    onError: (err) => void message.error(apiErrorMessage(err, "Could not read that file.")),
  });
  const commit = useMutation({
    mutationFn: () => musterApi.commitUpload(preview!.uploadId),
    onSuccess: (r) => {
      void message.success(`${r.saved} ${r.saved === 1 ? "day" : "days"} marked from the upload.`);
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ["attendance", "muster"] });
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not apply this upload. Upload the file again to see what changed.")),
  });

  const changes = preview ? preview.counts.timed + preview.counts.statusOnly + preview.counts.cleared : 0;
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Text strong>1. Download the template</Text>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          One row per person marked by hand at the branch, with IN and OUT columns for each day, already filled with what's marked so far. Type the times
          (10:05 and 19:10) or a letter in IN (P, A, P:A, A:P, W). A blank cell leaves the day as it is.
        </Paragraph>
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 8 }}
          title={<>To clear a day marked by mistake, type <Text code>-</Text> (a dash) in its IN cell.</>}
          description="The day goes back to Not marked. Deleting what's in the cell does not clear it: a blank cell always means 'leave as it is', so a partly filled sheet can't wipe anything."
        />
        <Space wrap>
          <Select aria-label="Branch" placeholder="Branch" style={{ width: 220 }} value={branch} onChange={setBranch} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          <Select aria-label="Attendance cycle" style={{ width: 200 }} value={cycle} onChange={setCycle} options={cycles.map((c) => ({ value: c.start, label: c.label }))} />
          <Button icon={<DownloadOutlined />} disabled={!branch || !cycle} loading={template.isPending} onClick={() => template.mutate()}>
            Download template
          </Button>
        </Space>
      </div>
      <div>
        <Text strong>2. Upload the filled-in file</Text>
        <div style={{ marginTop: 8 }}>
          <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => (upload.mutate(file), false)}>
            <Button icon={<UploadOutlined />} loading={upload.isPending}>
              Choose file and preview
            </Button>
          </Upload>
        </div>
      </div>
      {preview && (
        <div>
          <Text strong>3. Check and apply</Text>
          <Descriptions size="small" column={3} style={{ marginTop: 8 }} items={[
            { key: "b", label: "Branch", children: preview.branch },
            { key: "c", label: "Cycle", children: preview.cycle.label },
            { key: "f", label: "File", children: preview.fileName },
            { key: "t", label: "Times", children: preview.counts.timed },
            { key: "s", label: "Status only", children: preview.counts.statusOnly },
            { key: "x", label: "Cleared", children: preview.counts.cleared },
            { key: "u", label: "Unchanged", children: preview.counts.unchanged },
            { key: "bl", label: "Blank (left as is)", children: preview.counts.blank },
            { key: "i", label: "Problems", children: preview.counts.issues ? <Text type="danger">{preview.counts.issues}</Text> : 0 },
          ]} />
          {preview.issues.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ margin: "8px 0" }}
              title={`${preview.issues.length} ${preview.issues.length === 1 ? "cell or row" : "cells or rows"} won't be applied`}
              description={<ul style={{ margin: 0, paddingLeft: 18, maxHeight: 160, overflow: "auto" }}>{preview.issues.map((i, n) => <li key={n}>Row {i.row}{i.employeeCode ? ` (${i.employeeCode})` : ""}{i.date ? `, ${i.date}` : ""}: {i.issue}</li>)}</ul>}
            />
          )}
          {changes > 0 ? (
            <Table
              size="small"
              rowKey={(c) => `${c.employee}|${c.date}`}
              dataSource={preview.changes}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              columns={[
                { title: "Employee", dataIndex: "employee" },
                { title: "Date", dataIndex: "date" },
                { title: "Now", dataIndex: "before", render: (v: string | null) => (v ? <Text code>{v}</Text> : <Text type="secondary">not marked</Text>) },
                { title: "Becomes", dataIndex: "entry", render: (v: string, c) => (c.kind === "CLEARED" ? <Text type="danger">not marked</Text> : <Text code>{v}</Text>) },
                { title: "Kind", dataIndex: "kind", render: (k: string) => <Tag color={KIND[k]?.color}>{KIND[k]?.label ?? k}</Tag> },
              ]}
            />
          ) : (
            <Alert type="info" showIcon title="Nothing to change: every filled-in day already matches what's marked." />
          )}
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" disabled={changes === 0} loading={commit.isPending} onClick={() => commit.mutate()}>
              Apply {changes} {changes === 1 ? "change" : "changes"}
            </Button>
            <Button onClick={() => setPreview(null)}>Cancel</Button>
          </Space>
        </div>
      )}
    </Space>
  );
}

/** Import Center → "Manual attendance muster": the same panel, with its own branch and cycle lists. */
export function MusterUploadTab() {
  const cycles = useQuery({ queryKey: ["attendance", "muster", "cycles"], queryFn: musterApi.cycles });
  const muster = useQuery({ queryKey: ["attendance", "muster", {}], queryFn: () => musterApi.getMuster({}) });
  if (!cycles.data || !muster.data) return <Spin />;
  return <MusterUploadPanel branches={muster.data.filters.locations} cycles={cycles.data.cycles} />;
}
