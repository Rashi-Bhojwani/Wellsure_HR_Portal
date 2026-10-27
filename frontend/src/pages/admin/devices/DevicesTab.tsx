import { useEffect, useState, type ReactNode } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Col, DatePicker, Form, Input, InputNumber, Row, Select, Switch, Tooltip } from "antd";
import { EditOutlined, PlusOutlined, UsbOutlined } from "@ant-design/icons";
import * as biometricApi from "../../../api/biometric";
import type { DeviceInput, DeviceRow } from "../../../api/biometric";
import * as orgApi from "../../../api/org";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { CardGrid, ConfirmModal, EmptyState, QueryState, SideDrawer, Skel, StatusChip, toast } from "../../../ui";
import { AgentReportCell, ClockCell, HealthChip, RetentionCell } from "./DeviceHealthCells";
import { invalidateBiometric, when } from "./deviceLabels";

type DeviceForm = Omit<DeviceInput, "syncFrom"> & { syncFrom?: dayjs.Dayjs };
const DEVICE_FORM = "device-form";

/** Register or edit a device. Moving "Sync from" earlier re-sends from that date, so it is confirmed first (D-F3). */
export function DeviceDrawer({ editing, open, onClose }: { editing: DeviceRow | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm<DeviceForm>();
  const route = Form.useWatch("route", form);
  const [resend, setResend] = useState<DeviceInput | null>(null);
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data: agents = [] } = useQuery({ queryKey: ["biometric", "agents"], queryFn: biometricApi.listAgents });
  const save = useMutation({
    mutationFn: (val: DeviceInput) => (editing ? biometricApi.updateDevice(editing.id, { ...val, serialNumber: undefined }) : biometricApi.createDevice(val)),
    onSuccess: () => {
      invalidateBiometric(qc);
      toast.success("Device saved.");
      setResend(null);
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save this device.")),
  });
  const submit = (val: DeviceForm) => {
    const body: DeviceInput = { ...val, syncFrom: val.syncFrom ? val.syncFrom.format("YYYY-MM-DD") : undefined };
    // Moving the date earlier makes the agent read the whole log again and send from it (D-F3).
    if (editing && body.syncFrom && body.syncFrom < editing.syncFrom) {
      setResend(body);
      return;
    }
    save.mutate(body);
  };
  // Fill the form each time the drawer opens (for a new device, or the one being edited).
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(
      editing
        ? { ...editing, locationId: editing.location.id, agentId: editing.agent?.id ?? null, syncFrom: dayjs(editing.syncFrom) }
        : { route: "AGENT", timezone: "Asia/Kolkata", isSimulated: false, syncFrom: dayjs(), retentionDays: 3, retentionRecords: 20000 },
    );
  }, [open, editing, form]);

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "Register a device"}
      subtitle={editing ? editing.serialNumber : "A biometric machine at one of your branches."}
      formId={DEVICE_FORM}
      primaryLabel="Save"
      primaryLoading={save.isPending && !resend}
    >
      <Form id={DEVICE_FORM} form={form} layout="vertical" requiredMark={false} onFinish={submit}>
        <Form.Item name="serialNumber" label="Serial number" rules={[{ required: true, message: "Enter the serial number" }]} extra="From the device's system info. The agent checks the device reports this serial before reading it; push (ADMS) devices authenticate with it.">
          <Input disabled={!!editing} />
        </Form.Item>
        <Form.Item name="name" label="Name" rules={[{ required: true, message: "Give it a name" }]}>
          <Input placeholder="e.g. C-10 entrance" />
        </Form.Item>
        <Form.Item name="locationId" label="Branch" rules={[{ required: true, message: "Choose a branch" }]}>
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
          rules={[{ required: true, message: "Choose a date" }]}
          extra="The agent never sends a punch dated before this, so the first sync doesn't send the device's whole history. Moving it earlier sends again from that date."
        >
          <DatePicker format="D MMM YYYY" style={{ width: "100%" }} disabledDate={(d) => d.isAfter(dayjs(), "day")} />
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
        <p style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: -space[3], marginBottom: space[4] }}>
          How much the device keeps before old punches may be overwritten. Pessimistic (3 days, 20,000) until the model is known: if the device isn&apos;t read for half of this, a
          warning shows; at three quarters, an alarm. When the device reports its own capacity, that figure is used instead of the records.
        </p>
        <Form.Item name="timezone" label="Device clock timezone" rules={[{ required: true }]} extra="The device records local time with no zone; it is read in this one.">
          <Input />
        </Form.Item>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="model" label="Model">
              <Input placeholder="unknown until confirmed" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="firmware" label="Firmware">
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="isSimulated" label="Simulated (for testing before the machine arrives; refused in production)" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>

      <ConfirmModal
        open={resend !== null}
        onCancel={() => {
          if (!save.isPending) setResend(null);
        }}
        onConfirm={() => resend && save.mutate(resend)}
        loading={save.isPending}
        title="Send punches again from an earlier date?"
        description={
          resend?.syncFrom
            ? `The agent will read the device's whole log again and send every punch from ${dayjs(resend.syncFrom).format("D MMM YYYY")}. Punches already received are recognised and dropped, so nothing is counted twice. Punches older than the attendance policy's limit arrive flagged for you to accept or discard.`
            : undefined
        }
        confirmLabel="Send again from this date"
      />
    </SideDrawer>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <dt style={{ fontSize: fs.xs, color: v.textSecondary }}>{label}</dt>
      <dd style={{ margin: 0, fontSize: fs.table, color: v.textBody, wordBreak: "break-word" }}>{children}</dd>
    </div>
  );
}

/** One device as an integration card (settings-11): identity and health on top, what the agent reports below, actions at the foot. */
function DeviceCard({ d, onEdit, onToggle, toggling }: { d: DeviceRow; onEdit: () => void; onToggle: () => void; toggling: boolean }) {
  return (
    <article aria-label={d.name} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5], background: v.bgSurface, display: "flex", flexDirection: "column", gap: space[4], opacity: d.isActive ? 1 : 0.75 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
        <span aria-hidden style={{ width: 44, height: 44, flex: "none", borderRadius: radius.pill, background: v.accentSubtle, color: v.accentText, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.xl }}>
          <UsbOutlined />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
            <span style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, wordBreak: "break-word" }}>{d.name}</span>
            {d.isSimulated && <StatusChip tone="purple">Simulated</StatusChip>}
          </div>
          <div style={{ fontSize: fs.sm, color: v.textSecondary, marginTop: 2 }}>
            {d.serialNumber} · {d.location.name}
          </div>
        </div>
        <HealthChip status={d.status} />
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: `${space[3]}px ${space[4]}px`, margin: 0 }}>
        <Fact label="Route">
          {d.route === "AGENT" ? (
            <>
              Agent{d.agent ? `: ${d.agent.name}` : <span style={{ color: v.warningText }}> (none assigned)</span>}
            </>
          ) : (
            "ADMS push"
          )}
        </Fact>
        <Fact label="Agent says">
          <AgentReportCell d={d} />
        </Fact>
        <Fact label="Clock">
          <ClockCell d={d} />
        </Fact>
        <Fact label="Retention">
          <RetentionCell d={d} />
        </Fact>
        <Fact label="Waiting on the PC">{d.health.report?.outboxRecords ? <StatusChip tone="warning">{`${d.health.report.outboxRecords} punches`}</StatusChip> : "—"}</Fact>
        <Fact label="Last punch">{when(d.lastPunchAt)}</Fact>
        <Fact label="Sync from">{dayjs(d.syncFrom).format("D MMM YYYY")}</Fact>
      </dl>
      <div style={{ display: "flex", alignItems: "center", gap: space[3], flexWrap: "wrap", marginTop: "auto", paddingTop: space[3], borderTop: `1px solid ${v.borderDefault}` }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: space[2], minHeight: 44, cursor: "pointer" }}>
          <Switch checked={d.isActive} loading={toggling} onChange={onToggle} aria-label={`${d.name} active`} />
          <StatusChip status={d.isActive ? "ACTIVE" : "INACTIVE"}>{d.isActive ? "Active" : "Inactive"}</StatusChip>
        </label>
        <Tooltip title={`Edit ${d.name}`}>
          <Button icon={<EditOutlined />} onClick={onEdit} style={{ marginLeft: "auto" }}>
            Edit
          </Button>
        </Tooltip>
      </div>
    </article>
  );
}

export function DevicesTab({ onEdit, onRegister }: { onEdit: (d: DeviceRow) => void; onRegister: () => void }) {
  const qc = useQueryClient();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  const [deactivating, setDeactivating] = useState<DeviceRow | null>(null);
  const toggle = useMutation({
    mutationFn: (d: DeviceRow) => biometricApi.updateDevice(d.id, { isActive: !d.isActive }),
    onSuccess: (_, d) => {
      invalidateBiometric(qc);
      setDeactivating(null);
      toast.success(d.isActive ? `${d.name} deactivated.` : `${d.name} reactivated.`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update the device.")),
  });
  return (
    <QueryState
      isLoading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      isEmpty={data.length === 0}
      skeleton={
        <CardGrid min={340} gap={space[4]}>
          {[0, 1].map((i) => (
            <div key={i} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5] }}>
              <Skel w="45%" h={18} style={{ marginBottom: space[3] }} />
              <Skel w="70%" h={12} style={{ marginBottom: space[5] }} />
              <Skel h={64} />
            </div>
          ))}
        </CardGrid>
      }
      empty={
        <EmptyState
          title="No devices yet"
          description="The real machine is connected in the final Phase 2/3 step; simulated devices can be registered for testing."
          action={
            <Button type="primary" icon={<PlusOutlined />} onClick={onRegister}>
              Register a device
            </Button>
          }
        />
      }
    >
      <CardGrid min={340} gap={space[4]}>
        {data.map((d) => (
          <DeviceCard
            key={d.id}
            d={d}
            onEdit={() => onEdit(d)}
            toggling={toggle.isPending && toggle.variables?.id === d.id}
            onToggle={() => (d.isActive ? setDeactivating(d) : toggle.mutate(d))}
          />
        ))}
      </CardGrid>
      <ConfirmModal
        open={deactivating !== null}
        onCancel={() => {
          if (!toggle.isPending) setDeactivating(null);
        }}
        onConfirm={() => deactivating && toggle.mutate(deactivating)}
        loading={toggle.isPending}
        danger
        title={deactivating ? `Deactivate ${deactivating.name}?` : ""}
        description="You can reactivate it at any time. Nothing on the device itself is changed."
        confirmLabel="Deactivate"
      />
    </QueryState>
  );
}
