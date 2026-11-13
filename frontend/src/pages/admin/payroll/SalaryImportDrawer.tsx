import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Upload } from "antd";
import { DownloadOutlined, UploadOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { AssignmentPreview } from "../../../api/payroll";
import { saveBlob } from "../../../api/muster";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, SideDrawer, StatusChip, toast } from "../../../ui";
import { fs, space, v } from "../../../theme/tokens";

// IE-09 (docs/plans/A_PARITY_ROWS.md): salary assignments from our own template (not another system's file). Every row is checked; committing the same file creates
// ordinary salary revisions, one per structure, CTC and date, each waiting for a different director. Nothing is written to a salary until it is decided and applied.
type Row = AssignmentPreview["rows"][number];
type Group = AssignmentPreview["groups"][number];

export function SalaryImportDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [note, setNote] = useState("");
  const close = () => { setFile(null); setPreview(null); setNote(""); onClose(); };
  const doPreview = useMutation({ mutationFn: (f: File) => payrollApi.previewSalaryImport(f), onSuccess: setPreview, onError: (e) => { setPreview(null); toast.error(apiErrorMessage(e, "Could not read the file.")); } });
  const commit = useMutation({
    mutationFn: () => payrollApi.commitSalaryImport(file!, preview!.fingerprint, note.trim()),
    onSuccess: (r) => { toast.success(`${r.revisions.length} revision(s) prepared for ${r.people} people. A different director decides each.`); void queryClient.invalidateQueries({ queryKey: ["payroll"] }); close(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not import.")),
  });
  const problems = preview?.rows.filter((r) => r.problem).length ?? 0;
  const blocked = preview?.groups.some((g) => g.blockers.length > 0) ?? false;
  const ready = !!preview && preview.valid > 0 && problems === 0 && !blocked && note.trim().length >= 3;
  return (
    <SideDrawer open={open} onClose={close} title="Import salary assignments" subtitle="Our own template: who, which structure version, the annual CTC and from when." size="xwide" primaryLabel="Prepare the revisions" primaryDisabled={!ready} primaryLoading={commit.isPending} onPrimary={() => commit.mutate()}>
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", marginBottom: space[4] }}>
        <Button icon={<DownloadOutlined />} onClick={() => void payrollApi.salaryImportTemplate().then((b) => saveBlob(b, "salary-assignments-template.csv"), (e) => toast.error(apiErrorMessage(e, "Could not get the template.")))}>Download the template</Button>
        <Upload accept=".csv,.xlsx" showUploadList={false} beforeUpload={(f) => { setFile(f); doPreview.mutate(f); return false; }}>
          <Button icon={<UploadOutlined />} loading={doPreview.isPending}>Upload a file</Button>
        </Upload>
        {file && <span style={{ color: v.textSecondary, fontSize: fs.sm, alignSelf: "center" }}>{file.name}</span>}
      </div>
      {preview && (
        <>
          {problems > 0 && <ApprovalBanner tone="warning" title={`${problems} row(s) have a problem`} description="Fix them in the file and upload it again. Nothing is imported while any row has a problem." style={{ marginBottom: space[3] }} />}
          <DataTable<Group>
            rowKey={(g) => `${g.structureKey}-${g.structureVersion}-${g.annualCtc}-${g.effectiveFrom}`}
            dataSource={preview.groups}
            empty="No clean rows yet."
            pagination={false}
            columns={[
              { title: "Revision", key: "r", render: (_, g) => `${g.structureKey} v${g.structureVersion} from ${g.effectiveFrom}` },
              { title: "Annual CTC", dataIndex: "annualCtc", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "People", dataIndex: "people", align: "right" },
              { title: "Can be submitted", key: "b", render: (_, g) => (g.blockers.length ? <StatusChip tone="danger" title={g.blockers.join("; ")}>{g.blockers[0]}</StatusChip> : <StatusChip tone="success">Yes</StatusChip>) },
            ]}
          />
          <div style={{ height: space[4] }} />
          <DataTable<Row>
            rowKey="line"
            dataSource={preview.rows}
            pagination={{ pageSize: 20 }}
            columns={[
              { title: "Line", dataIndex: "line" },
              { title: "Employee", dataIndex: "employeeCode" },
              { title: "Structure", key: "s", render: (_, r) => `${r.structure} v${r.version}` },
              { title: "Annual CTC", dataIndex: "annualCtc", align: "right" },
              { title: "From", dataIndex: "effectiveFrom" },
              { title: "Check", key: "p", render: (_, r) => (r.problem ? <StatusChip tone="danger">{r.problem}</StatusChip> : <StatusChip tone="success">OK</StatusChip>) },
            ]}
          />
          <label htmlFor="import-note" style={{ display: "block", fontSize: fs.sm, margin: `${space[4]}px 0 ${space[1]}px` }}>What this file is (kept on each revision)</label>
          <Input id="import-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      )}
    </SideDrawer>
  );
}
