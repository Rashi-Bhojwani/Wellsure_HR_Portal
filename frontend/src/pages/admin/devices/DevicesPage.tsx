import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { CopyOutlined, EditOutlined, KeyOutlined, PlusOutlined } from "@ant-design/icons";
import * as biometricApi from "../../../api/biometric";
import type { AgentRow, BatchRow, DeviceInput, DeviceRow, FlaggedRow, HealthStatus, IncidentKind, IncidentRow, PersonWithoutMapping, UnmappedRow } from "../../../api/biometric";
import * as orgApi from "../../../api/org";
import { BulkAcceptFlaggedModal } from "../../../components/devices/BulkAcceptFlaggedModal";
import { DeviceWarnings } from "../../../components/devices/DeviceWarnings";
import { IngestionVolumeChart } from "../../../components/devices/IngestionVolumeChart";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs } from "../../../theme/tokens";

const { Title, Text, Paragraph } = Typography;
const when = (v: string | null) => (v ? dayjs(v).format("D MMM YYYY, HH:mm") : "—");
const invalidate = (qc: ReturnType<typeof useQueryClient>) => void qc.invalidateQueries({ queryKey: ["biometric"] });

// ── Health at a glance (P2-H) ────────────────────────────────────────────

const STATUS_TAG: Record<HealthStatus, { color: string; label: string; tip: string }> = {
  ONLINE: { color: "green", label: "Online", tip: "Heard from recently, with nothing open against it." },
  SILENT: { color: "red", label: "Gone quiet", tip: "No successful contact for the set time during working hours. See Incidents." },
  AGENT_OFFLINE: { color: "red", label: "Agent offline", tip: "The sync agent that reads it has stopped reporting, so nothing from it can arrive. See Incidents." },
  NOT_CONNECTED: { color: "default", label: "Not connected yet", tip: "Nothing has ever come from it. No alert is raised for something that has never worked; connect it (INSTALL.md) and it is watched from then on." },
  ATTENTION: { color: "orange", label: "Needs attention", tip: "Reachable, but something is open against it (no punches today, clock, or log). See Incidents." },
};
const KIND_LABEL: Record<IncidentKind, string> = {
  DEVICE_SILENT: "Device gone quiet",
  AGENT_SILENT: "Agent stopped reporting",
  NO_PUNCHES_TODAY: "No punches today",
  CLOCK_DRIFT: "Clock wrong",
  RETENTION_RISK: "Punches at risk on the device",
};

function StatusChip({ status }: { status: HealthStatus | null }) {
  if (!status) return <Text type="secondary">—</Text>;
  const t = STATUS_TAG[status];
  return (
    <Tooltip title={t.tip}>
      <Tag color={t.color}>{t.label}</Tag>
    </Tooltip>
  );
}

// ── Devices ──────────────────────────────────────────────────────────────

type DeviceForm = Omit<DeviceInput, "syncFrom"> & { syncFrom?: dayjs.Dayjs };

function DeviceModal({ editing, open, onClose }: { editing: DeviceRow | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm<DeviceForm>();
  const route = Form.useWatch("route", form);
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data: agents = [] } = useQuery({ queryKey: ["biometric", "agents"], queryFn: biometricApi.listAgents });
  const save = useMutation({
    mutationFn: (v: DeviceInput) => (editing ? biometricApi.updateDevice(editing.id, { ...v, serialNumber: undefined }) : biometricApi.createDevice(v)),
    onSuccess: () => {
      invalidate(qc);
      void message.success("Device saved.");
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save this device.")),
  });
  const submit = (v: DeviceForm) => {
    const body: DeviceInput = { ...v, syncFrom: v.syncFrom ? v.syncFrom.format("YYYY-MM-DD") : undefined };
    // Moving the date earlier makes the agent read the whole log again and send from it (D-F3).
    if (editing && body.syncFrom && body.syncFrom < editing.syncFrom) {
      Modal.confirm({
        title: "Send punches again from an earlier date?",
        content: `The agent will read the device's whole log again and send every punch from ${dayjs(body.syncFrom).format("D MMM YYYY")}. Punches already received are recognised and dropped, so nothing is counted twice. Punches older than the attendance policy's limit arrive flagged for you to accept or discard.`,
        okText: "Send again from this date",
        onOk: () => save.mutate(body),
      });
      return;
    }
    save.mutate(body);
  };
  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Register a device"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      afterOpenChange={(o) =>
        o &&
        form.setFieldsValue(
          editing
            ? { ...editing, locationId: editing.location.id, agentId: editing.agent?.id ?? null, syncFrom: dayjs(editing.syncFrom) }
            : { route: "AGENT", timezone: "Asia/Kolkata", isSimulated: false, syncFrom: dayjs(), retentionDays: 3, retentionRecords: 20000 },
        )
      }
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={submit}>
        <Form.Item name="serialNumber" label="Serial number" rules={[{ required: true }]} extra="From the device's system info. The agent checks the device reports this serial before reading it; push (ADMS) devices authenticate with it.">
          <Input disabled={!!editing} />
        </Form.Item>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input placeholder="e.g. C-10 entrance" />
        </Form.Item>
        <Form.Item name="locationId" label="Branch" rules={[{ required: true }]}>
          <Select options={locations.filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.hasBiometricDevice ? l.name : `${l.name} (marked as having no machine)` }))} />
        </Form.Item>
        <Form.Item name="route" label="How punches arrive" rules={[{ required: true }]}>
          <Select options={[{ value: "AGENT", label: "Sync agent on the office LAN (primary)" }, { value: "PUSH", label: "Device pushes to the server (ADMS)" }]} />
        </Form.Item>
        {route === "AGENT" && (
          <>
            <Form.Item name="agentId" label="Sync agent">
              <Select allowClear placeholder="Choose the agent that polls it" options={agents.filter((a) => a.isActive).map((a) => ({ value: a.id, label: a.name }))} />
            </Form.Item>
            <Form.Item name="lanIp" label="LAN IP address" extra="For reference: the agent's own config.json on the office PC is what it connects to.">
              <Input placeholder="e.g. 192.168.29.213" />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="syncFrom"
          label="Sync punches from"
          rules={[{ required: true }]}
          extra="The agent never sends a punch dated before this, so the first sync doesn't send the device's whole history. Moving it earlier sends again from that date."
        >
          <DatePicker format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs(), "day")} />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="retentionDays" label="Log holds about (days)" rules={[{ required: true }]}>
              <InputNumber min={1} max={365} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="retentionRecords" label="Log holds (records)" rules={[{ required: true }]}>
              <InputNumber min={100} max={10_000_000} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Text type="secondary" style={{ display: "block", marginTop: -12, marginBottom: 16 }}>
          How much the device keeps before old punches may be overwritten. Pessimistic (3 days, 20,000) until the model is known: if the device isn&apos;t read for half of
          this, a warning shows; at three quarters, an alarm. When the device reports its own capacity, that figure is used instead of the records.
        </Text>
        <Form.Item name="timezone" label="Device clock timezone" rules={[{ required: true }]} extra="The device records local time with no zone; it is read in this one.">
          <Input />
        </Form.Item>
        <Space size={12}>
          <Form.Item name="model" label="Model">
            <Input placeholder="unknown until confirmed" />
          </Form.Item>
          <Form.Item name="firmware" label="Firmware">
            <Input />
          </Form.Item>
        </Space>
        <Form.Item name="isSimulated" label="Simulated (for testing before the machine arrives; refused in production)" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            Save
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

const STATE_TAG: Record<string, { color: string; label: string }> = {
  OK: { color: "green", label: "Read OK" },
  NOT_YET_READ: { color: "default", label: "Not read yet" },
  UNREACHABLE: { color: "red", label: "Unreachable" },
  SERIAL_MISMATCH: { color: "red", label: "Wrong device at that address" },
  AUTH_FAILED: { color: "red", label: "Comm key refused" },
  NOT_ASSIGNED: { color: "orange", label: "Not assigned to the agent" },
  UNSUPPORTED_FORMAT: { color: "red", label: "Record layout not supported" },
  CONFIG_REFUSED: { color: "red", label: "Configuration refused" },
};

/** What the sync agent last said about the device (P2-F). */
function AgentReportCell({ d }: { d: DeviceRow }) {
  if (d.route !== "AGENT") return <Text type="secondary">—</Text>;
  const h = d.health;
  if (h.notConfiguredOnAgent) {
    return (
      <Tooltip title="The agent reported in but didn't mention this device: it isn't in that PC's config.json.">
        <Tag color="orange">Not configured on the agent PC</Tag>
      </Tooltip>
    );
  }
  if (!h.report) return <Text type="secondary">No report yet</Text>;
  const tag = STATE_TAG[h.report.state ?? ""] ?? { color: "default", label: h.report.state ?? "?" };
  return (
    <Space orientation="vertical" size={0}>
      <Tooltip title={h.report.lastError ?? undefined}>
        <Tag color={tag.color}>{tag.label}</Tag>
      </Tooltip>
      <Text type="secondary" style={{ fontSize: fs.sm }}>
        last read {when(h.lastReadAt)}
      </Text>
    </Space>
  );
}

function ClockCell({ d }: { d: DeviceRow }) {
  const c = d.health.clockDrift;
  if (!c) return <Text type="secondary">—</Text>;
  return c.exceeded ? (
    <Tooltip title="Beyond the threshold (System Settings → Attendance → Device health). Set the clock from the device's own menu; the system never changes it.">
      <Tag color="red">{c.text}</Tag>
    </Tooltip>
  ) : (
    <Text>{c.text}</Text>
  );
}

function RetentionCell({ d }: { d: DeviceRow }) {
  const r = d.health.retention;
  if (!r) return <Text type="secondary">—</Text>;
  const color = r.state === "RISK" ? "red" : r.state === "WARNING" ? "orange" : "green";
  const gap = r.gapHours === null ? "not read yet" : r.gapHours < 1 ? "read within the hour" : `${Math.round(r.gapHours)} h since a read`;
  return (
    <Space orientation="vertical" size={0}>
      <Tooltip title={`Log assumed to hold ${Math.round(r.windowHours / 24)} days. Warning at half, alarm at three quarters.`}>
        <Tag color={color}>{r.state === "OK" ? "OK" : r.state === "RISK" ? "At risk" : "Warning"}</Tag>
      </Tooltip>
      <Text type="secondary" style={{ fontSize: fs.sm }}>
        {gap}
      </Text>
      {r.logFullPercent !== null && (
        <Text type={r.logNearlyFull ? "danger" : "secondary"} style={{ fontSize: fs.sm }}>
          log {d.health.report?.logCount ?? "?"} / {r.capacityUsed ?? "?"} ({r.logFullPercent}%)
        </Text>
      )}
    </Space>
  );
}

function DevicesTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = useMutation({
    mutationFn: (d: DeviceRow) => biometricApi.updateDevice(d.id, { isActive: !d.isActive }),
    onSuccess: () => invalidate(qc),
    onError: (err) => void message.error(apiErrorMessage(err, "Could not update the device.")),
  });
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Button type="primary" icon={<PlusOutlined />} style={{ alignSelf: "flex-end" }} onClick={() => { setEditing(null); setOpen(true); }}>
        Register a device
      </Button>
      <Table<DeviceRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: true }}
        locale={{ emptyText: "No devices yet. The real machine is connected in the final Phase 2/3 step; simulated devices can be registered for testing." }}
        columns={[
          { title: "Device", key: "name", render: (_, d) => <><Text strong>{d.name}</Text> <Text type="secondary">{d.serialNumber}</Text> {d.isSimulated && <Tag color="purple">Simulated</Tag>}</> },
          { title: "Health", key: "health", render: (_, d) => <StatusChip status={d.status} /> },
          { title: "Branch", key: "loc", render: (_, d) => d.location.name },
          { title: "Route", key: "route", render: (_, d) => (d.route === "AGENT" ? <>Agent{d.agent ? `: ${d.agent.name}` : <Text type="warning"> (none assigned)</Text>}</> : "ADMS push") },
          { title: "Sync from", dataIndex: "syncFrom", render: (v: string) => dayjs(v).format("D MMM YYYY") },
          { title: "Agent says", key: "report", render: (_, d) => <AgentReportCell d={d} /> },
          { title: "Clock", key: "clock", render: (_, d) => <ClockCell d={d} /> },
          { title: "Retention", key: "retention", render: (_, d) => <RetentionCell d={d} /> },
          { title: "Waiting on the PC", key: "outbox", render: (_, d) => (d.health.report?.outboxRecords ? <Tag color="gold">{d.health.report.outboxRecords} punches</Tag> : "—") },
          { title: "Last punch", dataIndex: "lastPunchAt", render: when },
          { title: "Status", dataIndex: "isActive", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag> },
          {
            title: "",
            key: "actions",
            render: (_, d) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} onClick={() => { setEditing(d); setOpen(true); }}>Edit</Button>
                <Button size="small" onClick={() => toggle.mutate(d)}>{d.isActive ? "Deactivate" : "Reactivate"}</Button>
              </Space>
            ),
          },
        ]}
      />
      <DeviceModal editing={editing} open={open} onClose={() => setOpen(false)} />
    </Space>
  );
}

// ── Sync agents ──────────────────────────────────────────────────────────

/** The key is shown exactly once; after this it exists only as a hash. */
function KeyModal({ shown, onClose }: { shown: { name: string; key: string } | null; onClose: () => void }) {
  return (
    <Modal title={`Key for ${shown?.name ?? ""}`} open={!!shown} onCancel={onClose} onOk={onClose} okText="I've stored it" cancelButtonProps={{ style: { display: "none" } }} closable={false} maskClosable={false}>
      <Alert type="warning" showIcon title="Shown once" description="Copy this key into the agent's Windows Credential Manager entry now. It is stored only as a hash and can't be shown again — if it's lost, rotate the key." style={{ marginBottom: 12 }} />
      <Paragraph copyable={{ icon: <CopyOutlined /> }} code style={{ wordBreak: "break-all" }}>
        {shown?.key}
      </Paragraph>
    </Modal>
  );
}

function AgentsTab() {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["biometric", "agents"], queryFn: biometricApi.listAgents });
  const [name, setName] = useState("");
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const done = (r: { agent: AgentRow; key: string }) => {
    invalidate(qc);
    setShown({ name: r.agent.name, key: r.key });
  };
  const onError = (err: unknown) => void message.error(apiErrorMessage(err, "Could not update the agent."));
  const create = useMutation({ mutationFn: () => biometricApi.createAgent(name), onSuccess: (r) => { setName(""); done(r); }, onError });
  const rotate = useMutation({ mutationFn: biometricApi.rotateAgentKey, onSuccess: done, onError });
  const toggle = useMutation({ mutationFn: (a: AgentRow) => biometricApi.updateAgent(a.id, { isActive: !a.isActive }), onSuccess: () => invalidate(qc), onError });
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Space.Compact style={{ maxWidth: 420 }}>
        <Input placeholder="Agent name, e.g. C-10 office PC" value={name} onChange={(e) => setName(e.target.value)} aria-label="New agent name" />
        <Button type="primary" icon={<PlusOutlined />} disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
          Add agent
        </Button>
      </Space.Compact>
      <Table<AgentRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: "Agent", key: "name", render: (_, a) => <><Text strong>{a.name}</Text> <Text type="secondary" code>{a.keyPrefix}…</Text></> },
          { title: "Host / version", key: "host", render: (_, a) => (a.host ? `${a.host} · v${a.version ?? "?"}` : <Text type="secondary">Not connected yet</Text>) },
          { title: "Health", key: "health", render: (_, a) => <StatusChip status={a.status} /> },
          { title: "Last heartbeat", dataIndex: "lastHeartbeatAt", render: when },
          {
            title: "Set aside",
            key: "setAside",
            render: (_, a) => {
              const n = Number((a.lastHeartbeat as { quarantinedBatches?: number } | null)?.quarantinedBatches ?? 0);
              return n > 0 ? <Tooltip title="Batches of punches the server refused, kept on the agent PC and not in attendance. See INSTALL.md, 'Punches the server refused'."><Tag color="red">{n} refused</Tag></Tooltip> : "—";
            },
          },
          { title: "Devices", key: "devices", render: (_, a) => (a.devices.length ? a.devices.map((d) => <Tag key={d.id}>{d.name}</Tag>) : "—") },
          { title: "Status", dataIndex: "isActive", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag> },
          {
            title: "",
            key: "actions",
            render: (_, a) => (
              <Space>
                <Popconfirm title="Issue a new key?" description="The current key stops working immediately." onConfirm={() => rotate.mutate(a.id)}>
                  <Button size="small" icon={<KeyOutlined />}>Rotate key</Button>
                </Popconfirm>
                <Button size="small" onClick={() => toggle.mutate(a)}>{a.isActive ? "Deactivate" : "Reactivate"}</Button>
              </Space>
            ),
          },
        ]}
      />
      <KeyModal shown={shown} onClose={() => setShown(null)} />
    </Space>
  );
}

// ── Unmapped punches ─────────────────────────────────────────────────────

function MapModal({ row, onClose }: { row: UnmappedRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm<{ employeeId: string; effectiveFrom?: dayjs.Dayjs }>();
  const map = useMutation({
    mutationFn: (v: { employeeId: string; effectiveFrom?: dayjs.Dayjs }) => biometricApi.mapUnmapped({ deviceUserId: row!.deviceUserId, employeeId: v.employeeId, effectiveFrom: v.effectiveFrom?.format("YYYY-MM-DD") }),
    onSuccess: (r) => {
      invalidate(qc);
      void message.success(`Mapped from ${dayjs(r.mapping.validFrom).format("D MMM YYYY")}: ${r.resolved} punch(es) now counted${r.stillUnmapped ? `, ${r.stillUnmapped} still unmapped (before they joined)` : ""}.`);
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not map this device ID.")),
  });
  return (
    <Modal title={`Map device user ID ${row?.deviceUserId ?? ""}`} open={!!row} onCancel={onClose} footer={null} destroyOnHidden>
      <Paragraph type="secondary">
        {row?.punches} punch(es) from {row ? dayjs(row.firstAt).format("D MMM YYYY") : ""}. The mapping starts on the first of them (or the date you choose, never before
        they joined), the punches are given to this person, and their days are recomputed. One device ID is never two people on the same day.
      </Paragraph>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => map.mutate(v)}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
          <EmployeePicker />
        </Form.Item>
        <Form.Item name="effectiveFrom" label="From (optional)">
          <DatePicker format="D MMM YYYY" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={map.isPending}>Map</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function UnmappedTab() {
  const { data = [], isLoading } = useQuery({ queryKey: ["biometric", "unmapped"], queryFn: biometricApi.listUnmapped });
  const [mapping, setMapping] = useState<UnmappedRow | null>(null);
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Text type="secondary">Punches whose device user ID nobody had on that day. They are kept, never discarded, and counted as soon as the ID is mapped.</Text>
      <Table<UnmappedRow>
        rowKey="deviceUserId"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        locale={{ emptyText: "No unmapped punches." }}
        columns={[
          { title: "Device user ID", dataIndex: "deviceUserId" },
          { title: "Punches", dataIndex: "punches" },
          { title: "First", dataIndex: "firstAt", render: when },
          { title: "Latest", dataIndex: "lastAt", render: when },
          { title: "Devices", dataIndex: "devices", render: (d: string[]) => d.join(", ") },
          { title: "", key: "map", render: (_, r) => <Button size="small" type="primary" onClick={() => setMapping(r)}>Map to employee</Button> },
        ]}
      />
      <MapModal row={mapping} onClose={() => setMapping(null)} />
      <PeopleWithoutMapping />
    </Space>
  );
}

/** People at a branch that has a machine but who have no device user ID: if they punch, it lands above; and on a day they are expected they look absent. */
function PeopleWithoutMapping() {
  const { data = [], isLoading } = useQuery({ queryKey: ["biometric", "people-without-mapping"], queryFn: biometricApi.listPeopleWithoutMapping });
  return (
    <Space orientation="vertical" size={8} style={{ width: "100%", marginTop: 16 }}>
      <Title level={5} style={{ margin: 0 }}>
        People at branches with a machine but no device user ID
      </Title>
      <Text type="secondary">Employed today, placed at a branch that has an active biometric device, and with no device user ID mapped. Map their ID from the employee&apos;s record (Attendance capture).</Text>
      <Table<PersonWithoutMapping>
        size="small"
        rowKey="employeeId"
        loading={isLoading}
        dataSource={data}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: "Everyone at a branch with a machine has a device user ID." }}
        columns={[
          { title: "Employee code", dataIndex: "employeeCode" },
          { title: "Branch", dataIndex: "branch" },
        ]}
      />
    </Space>
  );
}

// ── Incidents (P2-H) ─────────────────────────────────────────────────────

function IncidentsTab() {
  const { data = [], isLoading } = useQuery({ queryKey: ["biometric", "incidents"], queryFn: () => biometricApi.listIncidents({ state: "all", limit: 100 }) });
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Text type="secondary">
        Each stretch of trouble with a device or a sync agent: when it started, how long it lasted, and what was missed. Open ones are first. HR is told once when one opens, once more if it is still open at the start of the next working day, and once when it closes.
      </Text>
      <Table<IncidentRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: "No incidents. Nothing has gone quiet." }}
        expandable={{ expandedRowRender: (i) => <Paragraph style={{ margin: 0 }}>{i.detail}</Paragraph> }}
        columns={[
          { title: "State", key: "state", render: (_, i) => (i.isOpen ? <Tag color="red">Open</Tag> : <Tag color="green">Closed</Tag>) },
          { title: "What", key: "kind", render: (_, i) => KIND_LABEL[i.kind] },
          { title: "Device / agent", key: "subject", render: (_, i) => <>{i.subject}{i.branch ? <Text type="secondary"> · {i.branch}</Text> : null}</> },
          { title: "Started", dataIndex: "openedAt", render: when },
          { title: "Ended", dataIndex: "resolvedAt", render: (v: string | null) => v ? when(v) : <Text type="danger">still open</Text> },
          { title: "Lasted", dataIndex: "duration" },
          {
            title: "What was missed",
            key: "recovery",
            render: (_, i) =>
              i.recovery?.arrivedPunches != null
                ? `${i.recovery.arrivedPunches} punch${i.recovery.arrivedPunches === 1 ? "" : "es"} arrived afterwards${i.recovery.expectedWithoutPunch ? `; ${i.recovery.expectedWithoutPunch} still without one` : ""}`
                : i.isOpen
                  ? ""
                  : "—",
          },
          { title: "", key: "esc", render: (_, i) => (i.escalatedAt ? <Tooltip title={`Told again at the start of the next working day (${when(i.escalatedAt)})`}><Tag>repeated</Tag></Tooltip> : null) },
        ]}
      />
    </Space>
  );
}

// ── Volume (P2-H) ────────────────────────────────────────────────────────

function VolumeTab() {
  const { data: devices = [] } = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  return <IngestionVolumeChart devices={devices.map((d) => ({ id: d.id, name: d.name }))} />;
}

// ── Flagged punches ──────────────────────────────────────────────────────

function FlaggedTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<biometricApi.FlaggedFilter>({});
  const [ticked, setTicked] = useState<string[]>([]);
  const [bulk, setBulk] = useState<biometricApi.FlaggedSelection | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["biometric", "flagged", filter], queryFn: () => biometricApi.listFlagged(filter) });
  const { data: devices = [] } = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  const rows = data?.flagged ?? [];
  const total = data?.total ?? 0;
  const filtered = Object.values(filter).some((v) => v !== undefined);
  const [deciding, setDeciding] = useState<{ row: FlaggedRow; decision: "ACCEPTED" | "DISCARDED" } | null>(null);
  const [reason, setReason] = useState("");
  const resolve = useMutation({
    mutationFn: () => biometricApi.resolveFlag(deciding!.row.id, { decision: deciding!.decision, reason }),
    onSuccess: () => {
      invalidate(qc);
      setDeciding(null);
      setReason("");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not record the decision.")),
  });
  const setF = (patch: Partial<biometricApi.FlaggedFilter>) => {
    setFilter((f) => ({ ...f, ...patch }));
    setTicked([]);
  };
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Text type="secondary">
        Punches with an implausible time — in the future, or very old — usually mean the device clock is wrong. They are stored but left out of attendance until you accept or
        discard them. When a device goes wrong, flagged punches arrive for a whole branch at once: filter to them, tick them, or accept everything that matches, after seeing exactly
        what that is.
      </Text>
      <Space wrap>
        <Select
          allowClear
          placeholder="Any device"
          style={{ width: 240 }}
          value={filter.deviceId}
          onChange={(v) => setF({ deviceId: v })}
          options={devices.map((d) => ({ value: d.id, label: d.name }))}
        />
        <Select
          allowClear
          placeholder="Any reason"
          style={{ width: 160 }}
          value={filter.flag}
          onChange={(v) => setF({ flag: v })}
          options={[{ value: "TOO_OLD", label: "Too old" }, { value: "FUTURE", label: "In the future" }]}
        />
        <DatePicker.RangePicker
          format="D MMM YYYY"
          value={filter.from && filter.to ? [dayjs(filter.from), dayjs(filter.to)] : null}
          onChange={(v) => setF({ from: v?.[0]?.format("YYYY-MM-DD"), to: v?.[1]?.format("YYYY-MM-DD") })}
        />
        <Button disabled={!filtered} onClick={() => setF({ deviceId: undefined, flag: undefined, from: undefined, to: undefined })}>Clear filters</Button>
      </Space>
      <Space wrap>
        <Button type="primary" disabled={ticked.length === 0} onClick={() => setBulk({ ids: ticked })}>
          {ticked.length ? `Accept the ${ticked.length} ticked…` : "Accept ticked…"}
        </Button>
        <Tooltip title={!filtered ? "Choose a device, a reason or dates first, so you know what you are accepting." : total > 2000 ? "More than 2,000 match: narrow it and accept in parts." : ""}>
          <span>
            <Button disabled={!filtered || total === 0 || total > 2000} onClick={() => setBulk({ filter })}>
              {filtered ? `Accept all ${total} that match…` : "Accept all that match…"}
            </Button>
          </span>
        </Tooltip>
        <Text type="secondary">
          {total > rows.length ? `Showing the latest ${rows.length} of ${total}. ` : ""}
          You will see every punch and confirm before anything is accepted.
        </Text>
      </Space>
      <Table<FlaggedRow>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 50 }}
        rowSelection={{ selectedRowKeys: ticked, onChange: (keys) => setTicked(keys as string[]), preserveSelectedRowKeys: true }}
        locale={{ emptyText: filtered ? "No flagged punches match." : "No flagged punches." }}
        columns={[
          { title: "Device", dataIndex: "device" },
          { title: "Device user ID", dataIndex: "deviceUserId" },
          { title: "Employee", key: "emp", render: (_, r) => r.employee?.name ?? <Text type="secondary">unmapped</Text> },
          { title: "Device time", dataIndex: "localTime" },
          { title: "Received", dataIndex: "receivedAt", render: when },
          { title: "Flag", dataIndex: "flag", render: (f: string) => <Tag color="orange">{f === "FUTURE" ? "In the future" : "Too old"}</Tag> },
          {
            title: "",
            key: "decide",
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => setDeciding({ row: r, decision: "ACCEPTED" })}>Accept</Button>
                <Button size="small" danger onClick={() => setDeciding({ row: r, decision: "DISCARDED" })}>Discard</Button>
              </Space>
            ),
          },
        ]}
      />
      <BulkAcceptFlaggedModal
        key={JSON.stringify(bulk)}
        selection={bulk}
        onClose={() => {
          setBulk(null);
          setTicked([]);
        }}
      />
      <Modal
        title={deciding?.decision === "ACCEPTED" ? "Accept this punch?" : "Discard this punch?"}
        open={!!deciding}
        onCancel={() => setDeciding(null)}
        onOk={() => resolve.mutate()}
        okButtonProps={{ disabled: !reason.trim(), loading: resolve.isPending }}
      >
        <Paragraph>
          {deciding?.row.deviceUserId} at {deciding?.row.localTime} on {deciding?.row.device}.{" "}
          {deciding?.decision === "ACCEPTED" ? "It will count towards attendance from now on." : "It stays on record but never counts."}
        </Paragraph>
        <Input.TextArea rows={2} placeholder="Why (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </Space>
  );
}

// ── Recent batches ───────────────────────────────────────────────────────

function BatchesTab() {
  const { data = [], isLoading } = useQuery({ queryKey: ["biometric", "batches"], queryFn: () => biometricApi.listBatches() });
  return (
    <Table<BatchRow>
      rowKey="id"
      loading={isLoading}
      dataSource={data}
      pagination={false}
      scroll={{ x: true }}
      locale={{ emptyText: "Nothing received yet." }}
      expandable={{
        rowExpandable: (b) => b.rejectedLines.length > 0,
        expandedRowRender: (b) => (
          <Table
            size="small"
            rowKey="lineNumber"
            pagination={false}
            dataSource={b.rejectedLines}
            columns={[
              { title: "Line", dataIndex: "lineNumber" },
              { title: "As received", dataIndex: "raw", render: (v: string) => <Text code>{v}</Text> },
              { title: "Why rejected", dataIndex: "reason" },
            ]}
          />
        ),
      }}
      columns={[
        { title: "Received", dataIndex: "receivedAt", render: when },
        { title: "Route", dataIndex: "route", render: (r: string) => ({ AGENT: "Agent", PUSH: "ADMS push", IMPORT: "File upload" })[r] ?? r },
        { title: "Device", key: "device", render: (_, b) => b.device.name },
        { title: "New", dataIndex: "newCount" },
        { title: "Duplicate", dataIndex: "duplicateCount" },
        { title: "Unmapped", dataIndex: "unmappedCount", render: (v: number) => (v ? <Tag color="gold">{v}</Tag> : 0) },
        { title: "Flagged", dataIndex: "flaggedCount", render: (v: number) => (v ? <Tag color="orange">{v}</Tag> : 0) },
        { title: "Rejected", dataIndex: "rejectedCount", render: (v: number) => (v ? <Tag color="red">{v}</Tag> : 0) },
        { title: "Upload reason", dataIndex: "reason", render: (v: string | null) => v ?? "" },
      ]}
    />
  );
}

// Admin Tools → Devices (Phase 2 P2-B; P2-F adds what the sync agent reports
// and the warnings; P2-H adds health at a glance, the incident history, and
// ingestion volume).
export function DevicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = ["devices", "agents", "incidents", "volume", "unmapped", "flagged", "batches"].includes(searchParams.get("tab") ?? "") ? searchParams.get("tab")! : "devices"; // links from other screens (Finalisation, Exceptions) open a tab
  const { data: unmapped = [] } = useQuery({ queryKey: ["biometric", "unmapped"], queryFn: biometricApi.listUnmapped });
  const { data: flagged } = useQuery({ queryKey: ["biometric", "flagged", "count"], queryFn: () => biometricApi.listFlagged() });
  const { data: openIncidents = [] } = useQuery({ queryKey: ["biometric", "incidents", "open"], queryFn: () => biometricApi.listIncidents({ state: "open", limit: 100 }) });
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Devices
      </Title>
      <HelpStrip storageKey="biometric-devices-help">
        Biometric machines and the sync agents that read them. Punches arrive through the agent (primary), ADMS push, or an emergency file upload (Import Center),
        and all go through the same checks: exact duplicates are dropped, implausible times are flagged, and punches nobody's device ID covers wait in Unmapped.
        The agent only ever reads a device: it never changes, clears or pauses it, and never sets its clock.
      </HelpStrip>
      <DeviceWarnings />
      <Tabs
        activeKey={tab}
        onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
        items={[
          { key: "devices", label: "Devices", children: <DevicesTab /> },
          { key: "agents", label: "Sync agents", children: <AgentsTab /> },
          { key: "incidents", label: <Badge count={openIncidents.length} size="small" offset={[8, 0]}>Incidents</Badge>, children: <IncidentsTab /> },
          { key: "volume", label: "Volume", children: <VolumeTab /> },
          { key: "unmapped", label: <Badge count={unmapped.length} size="small" offset={[8, 0]}>Unmapped</Badge>, children: <UnmappedTab /> },
          { key: "flagged", label: <Badge count={flagged?.total ?? 0} size="small" offset={[8, 0]}>Flagged</Badge>, children: <FlaggedTab /> },
          { key: "batches", label: "Recent batches", children: <BatchesTab /> },
        ]}
      />
    </Space>
  );
}
