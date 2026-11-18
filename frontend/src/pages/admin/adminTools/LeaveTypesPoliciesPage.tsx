import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown, Form, Input, InputNumber, Select, Switch, Tooltip } from "antd";
import { EditOutlined, MoreOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { LeavePolicy, LeaveTypeAdminRow } from "../../../api/leave";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { useAuth } from "../../../hooks/useAuth";
import { space } from "../../../theme/tokens";
import { ApprovalBanner, CardGrid, EmptyState, FormGroupTitle, KeyValueGrid, PageHeader, Panel, SideDrawer, SkeletonCard, Stack, StatusChip, toast, useIsPhone } from "../../../ui";

const TYPE_FORM = "leave-type-form";
const POLICY_FORM = "leave-policy-form";

function TypeDrawer({ open, editing, onClose }: { open: boolean; editing: LeaveTypeAdminRow | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (values: { code: string; name: string; isPaid: boolean; allowHalfDay: boolean; isActive?: boolean }) =>
      editing ? leaveApi.updateLeaveType(editing.id, values) : leaveApi.createLeaveType(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "types"] });
      toast.success(editing ? "Leave type updated." : "Leave type created.");
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save this leave type.")),
  });

  return (
    <SideDrawer open={open} onClose={onClose} title={editing ? `Edit ${editing.name}` : "Add Leave Type"} formId={TYPE_FORM} primaryLabel="Save" primaryLoading={saveMutation.isPending}>
      <Form
        id={TYPE_FORM}
        key={editing?.id ?? "new"}
        form={form}
        layout="vertical"
        requiredMark={false}
        size="large"
        initialValues={editing ?? { isPaid: true, allowHalfDay: true, isActive: true }}
        onFinish={(val) => saveMutation.mutate(val)}
      >
        <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Z0-9_]+$/, message: "Upper-case letters, digits or underscore" }]}>
          <Input disabled={!!editing} placeholder="e.g. SICK" />
        </Form.Item>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="isPaid" label="Paid" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="allowHalfDay" label="Allow half-day" valuePropName="checked">
          <Switch />
        </Form.Item>
        {editing && (
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
      </Form>
    </SideDrawer>
  );
}

const twoCol = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", columnGap: space[4] } as const;

// Every leave_policies field is shown here, uniformly, regardless of which
// leave type conventionally uses it — the standing rule that every
// configurable value gets an admin screen, and a future 6th leave type
// might use a field only PL/COF/WFH/RH use today.
function PolicyDrawer({ open, leaveType, onClose }: { open: boolean; leaveType: LeaveTypeAdminRow | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (values: Partial<Omit<LeavePolicy, "id" | "leaveTypeId">>) => leaveApi.upsertLeavePolicy(leaveType!.id, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "types", "all"] });
      toast.success("Policy updated.");
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save this policy.")),
  });

  return (
    <SideDrawer open={open} onClose={onClose} size="wide" title={`${leaveType?.name ?? ""} — Policy`} subtitle={leaveType?.code} formId={POLICY_FORM} primaryLabel="Save Policy" primaryLoading={saveMutation.isPending}>
      <Form id={POLICY_FORM} key={leaveType?.id ?? "none"} form={form} layout="vertical" requiredMark={false} size="large" initialValues={leaveType?.policy ?? {}} onFinish={(val) => saveMutation.mutate(val)}>
        <FormGroupTitle>Accrual</FormGroupTitle>
        <div style={twoCol}>
          <Form.Item name="accrualEnabled" label="Accrual enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="accrualDaysPerMonth" label="Days per month (blank: Not set, the monthly accrual refuses)">
            <InputNumber style={{ width: "100%" }} min={0} max={31} step={0.5} placeholder="Not set" />
          </Form.Item>
          <Form.Item name="eligibilityMode" label="Eligibility mode (blank: Not set, the monthly accrual refuses)">
            <Select
              allowClear
              placeholder="Not set"
              options={[
                { value: "DAYS", label: "Calendar days from DOJ" },
                { value: "CALENDAR_MONTHS", label: "Calendar months from DOJ" },
              ]}
            />
          </Form.Item>
          <Form.Item name="eligibilityValue" label="Eligibility value (0 = from joining; blank: Not set)">
            <InputNumber style={{ width: "100%" }} min={0} placeholder="Not set" />
          </Form.Item>
        </div>

        {/* Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 3): year end reads exactly these. Both start Not set; while either is, the year-end run refuses. */}
        <FormGroupTitle>Year end (31 December)</FormGroupTitle>
        <p style={{ marginTop: 0 }}>At year end at most the carry-forward cap is carried into the new year; the rest is encashed if year-end encashment is on, or lapses if it is off. These apply to the leave type chosen as the earned leave type (Default behaviours).</p>
        <div style={twoCol}>
          <Form.Item name="carryForwardRule" label="Carried into the new year">
            <Select allowClear placeholder="Not set" options={[{ value: "CAPPED", label: "At most a number of days" }, { value: "UNLIMITED", label: "No limit (everything is carried)" }]} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.carryForwardRule !== b.carryForwardRule}>
            {({ getFieldValue }) =>
              getFieldValue("carryForwardRule") === "CAPPED" ? (
                <Form.Item name="carryForwardCapDays" label="Carry-forward cap (days; 0 carries nothing)" rules={[{ required: true, message: "Enter the cap in days" }]}>
                  <InputNumber style={{ width: "100%" }} min={0} />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item name="yearEndEncashment" label="Year-end encashment">
            <Select allowClear placeholder="Not set" options={[{ value: true, label: "On: encash what is not carried" }, { value: false, label: "Off: what is not carried lapses" }]} />
          </Form.Item>
        </div>

        <FormGroupTitle>Balance rules</FormGroupTitle>
        <div style={twoCol}>
          <Form.Item name="negativeBalanceAllowed" label="Negative balance allowed" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="skipBalanceCheck" label="Skip balance check entirely" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>

        <FormGroupTitle>Comp-off (the comp-off leave type)</FormGroupTitle>
        <div style={twoCol}>
          <Form.Item name="compOffMinHoursWorked" label="Min hours worked to earn a credit (blank: Not set, comp-off grants refuse)">
            <InputNumber style={{ width: "100%" }} min={0} max={24} step={0.5} placeholder="Not set" />
          </Form.Item>
          <Form.Item name="compOffExpiryDays" label="Expiry (days from earning; blank: Not set, comp-off grants refuse)">
            <InputNumber style={{ width: "100%" }} min={0} placeholder="Not set" />
          </Form.Item>
        </div>

        <FormGroupTitle>Work from home limits (enforced when someone applies)</FormGroupTitle>
        <div style={twoCol}>
          <Form.Item name="wfhMonthlyLimit" label="Monthly limit (days) — blank for no limit">
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="wfhYearlyLimit" label="Yearly limit (days) — blank for no limit">
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </div>

        <FormGroupTitle>Restricted holiday quota (enforced when someone applies)</FormGroupTitle>
        <Form.Item name="rhYearlyQuota" label="Yearly quota (days) — blank for no limit">
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

const blankAs = (val: number | null, unit: string, blank: string) => (val === null || val === undefined ? blank : `${val} ${unit}`);
const yesNo = (b: boolean) => (b ? "Yes" : "No");

function policyItems(p: LeavePolicy) {
  return [
    { key: "accrual", label: "Accrual", value: p.accrualEnabled ? (p.accrualDaysPerMonth === null ? "On, days per month Not set (refused)" : `${p.accrualDaysPerMonth} day(s) / month`) : "Off" },
    { key: "elig", label: "Eligibility", value: p.eligibilityMode && p.eligibilityValue !== null ? `${p.eligibilityValue} ${p.eligibilityMode === "DAYS" ? "days" : "months"} from DOJ` : "Not set" },
    ...(p.compOffMinHoursWorked !== null || p.compOffExpiryDays !== null ? [{ key: "cof", label: "Comp-off", value: `${p.compOffMinHoursWorked === null ? "minimum hours Not set" : `${p.compOffMinHoursWorked} h minimum`}; ${p.compOffExpiryDays === null ? "expiry Not set" : `expires after ${p.compOffExpiryDays} days`}` }] : []),
    { key: "cf", label: "Carried into the new year", value: p.carryForwardRule === "UNLIMITED" ? "No limit" : p.carryForwardRule === "CAPPED" ? `At most ${p.carryForwardCapDays ?? 0} day(s)` : "Not set" },
    { key: "enc", label: "Year-end encashment", value: p.yearEndEncashment === null ? "Not set" : p.yearEndEncashment ? "On" : "Off (lapses)" },
    ...(p.wfhMonthlyLimit !== null || p.wfhYearlyLimit !== null ? [{ key: "wfh", label: "Work from home limit", value: `${blankAs(p.wfhMonthlyLimit, "a month", "No monthly limit")}; ${blankAs(p.wfhYearlyLimit, "a year", "no yearly limit")}` }] : []),
    ...(p.rhYearlyQuota !== null ? [{ key: "rh", label: "Restricted holiday quota", value: `${p.rhYearlyQuota} a year` }] : []),
    { key: "neg", label: "Negative balance", value: p.skipBalanceCheck ? "No balance check" : yesNo(p.negativeBalanceAllowed) },
  ];
}

function TypePanel({ t, canManage, onEditType, onEditPolicy }: { t: LeaveTypeAdminRow; canManage: boolean; onEditType: () => void; onEditPolicy: () => void }) {
  return (
    <Panel
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          {t.name}
          <StatusChip tone="neutral">{t.code}</StatusChip>
          <StatusChip tone={t.isPaid ? "success" : "neutral"}>{t.isPaid ? "Paid" : "Unpaid"}</StatusChip>
          {t.allowHalfDay && <StatusChip tone="info">Half-day</StatusChip>}
        </span>
      }
      extra={
        <>
          <StatusChip status={t.isActive ? "ACTIVE" : "INACTIVE"}>{t.isActive ? "Active" : "Inactive"}</StatusChip>
          {canManage && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "type", icon: <EditOutlined />, label: "Edit type", onClick: onEditType },
                  { key: "policy", icon: <SettingOutlined />, label: t.policy ? "Edit policy" : "Set policy", onClick: onEditPolicy },
                ],
              }}
            >
              <Tooltip title="More actions">
                <Button type="text" aria-label={`More actions for ${t.name}`} icon={<MoreOutlined />} />
              </Tooltip>
            </Dropdown>
          )}
        </>
      }
      style={{ height: "100%" }}
    >
      {t.policy ? (
        <KeyValueGrid items={policyItems(t.policy)} />
      ) : (
        <ApprovalBanner
          tone="warning"
          title="No policy set"
          actions={
            canManage ? (
              <Button size="small" onClick={onEditPolicy}>
                Set policy
              </Button>
            ) : undefined
          }
        />
      )}
    </Panel>
  );
}

export function LeaveTypesPoliciesPage() {
  const { hasPermission } = useAuth();
  const phone = useIsPhone();
  const canManage = hasPermission("leave.policy.manage");
  const { data: leaveTypes = [], isLoading, error, refetch } = useQuery({ queryKey: ["leave", "types", "all"], queryFn: leaveApi.listAllLeaveTypes });
  const [typeDrawerOpen, setTypeDrawerOpen] = useState(false);
  const [editingType, setEditingType] = useState<LeaveTypeAdminRow | null>(null);
  const [policyDrawerOpen, setPolicyDrawerOpen] = useState(false);
  const [editingPolicyFor, setEditingPolicyFor] = useState<LeaveTypeAdminRow | null>(null);

  function openCreate() {
    setEditingType(null);
    setTypeDrawerOpen(true);
  }
  function openEditType(t: LeaveTypeAdminRow) {
    setEditingType(t);
    setTypeDrawerOpen(true);
  }
  function openEditPolicy(t: LeaveTypeAdminRow) {
    setEditingPolicyFor(t);
    setPolicyDrawerOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Leave Types & Policies"
        subtitle="Leave types and how each one accrues, carries over and is checked"
        actions={
          canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} block={phone}>
              Add Leave Type
            </Button>
          )
        }
      />
      <Stack>
        <HelpStrip storageKey="leave-types-policies-help">
          Every leave type's policy is configurable here — accrual, eligibility, carry-forward, balance rules, comp-off, WFH and Restricted Holiday limits. Several defaults below are still pending the owners
          confirmation (see docs/PROGRESS.md's Open Questions) — change them here once confirmed.
        </HelpStrip>

        {error ? (
          <Panel>
            <EmptyState kind="error" compact onRetry={() => void refetch()} />
          </Panel>
        ) : isLoading ? (
          <CardGrid min={420}>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonCard key={i} lines={4} />
            ))}
          </CardGrid>
        ) : leaveTypes.length === 0 ? (
          <Panel>
            <EmptyState
              illustration="documents"
              title="No leave types yet"
              description={canManage ? "Add the first leave type, then set its policy." : null}
              action={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Add Leave Type</Button> : undefined}
            />
          </Panel>
        ) : (
          <CardGrid min={420}>
            {leaveTypes.map((t) => (
              <TypePanel key={t.id} t={t} canManage={canManage} onEditType={() => openEditType(t)} onEditPolicy={() => openEditPolicy(t)} />
            ))}
          </CardGrid>
        )}
      </Stack>

      <TypeDrawer open={typeDrawerOpen} editing={editingType} onClose={() => setTypeDrawerOpen(false)} />
      <PolicyDrawer open={policyDrawerOpen} leaveType={editingPolicyFor} onClose={() => setPolicyDrawerOpen(false)} />
    </>
  );
}
