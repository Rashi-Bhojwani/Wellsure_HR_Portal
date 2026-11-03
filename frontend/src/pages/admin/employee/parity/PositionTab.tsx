import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as attendanceApi from "../../../../api/attendance";
import * as orgApi from "../../../../api/org";
import * as parityApi from "../../../../api/parity";
import { useAuth } from "../../../../hooks/useAuth";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { EffectiveDateHint } from "../../../../lib/effectiveDate";
import { CardGrid, EmptyState, QueryState, SideDrawer, SkeletonCard, StatusChip, Timeline, toast } from "../../../../ui";
import { fs, fw, space, v } from "../../../../theme/tokens";
import { ProfileSection, SectionStack } from "../ProfileLayout";

// A-9 G2 (item 9): one card per attribute with its current value and when it took effect, and every earlier value. A change is a new dated entry, written by the
// same code that changes job details or attendance assignments elsewhere (so nothing can disagree), and it needs a reason. Nothing is ever edited in place.

const STALE = 30_000;
const TONE = { past: "neutral", current: "accent", scheduled: "info" } as const;
const CLEARABLE: parityApi.PositionAttribute[] = ["grade", "costCentre"];

function ChangeDrawer({ employeeId, attribute, onClose }: { employeeId: string; attribute: { key: parityApi.PositionAttribute; label: string; current: parityApi.PositionEntry | null }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ valueId?: string; effectiveFrom: dayjs.Dayjs; reason: string }>();
  const effectiveFrom = Form.useWatch("effectiveFrom", form);
  const options = useQuery({
    queryKey: ["position-options", attribute.key],
    staleTime: STALE,
    queryFn: async (): Promise<Array<{ value: string; label: string }>> => {
      const simple = (rows: Array<{ id: string; name: string }>) => rows.map((r) => ({ value: r.id, label: r.name }));
      switch (attribute.key) {
        case "department":
          return simple(await orgApi.departments.list());
        case "designation":
          return simple(await orgApi.designations.list());
        case "location":
          return simple(await orgApi.listLocations(false));
        case "grade":
          return simple(await orgApi.grades.list());
        case "costCentre":
          return simple(await orgApi.costCentres.list());
        case "shift":
          return (await attendanceApi.listShifts()).filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` }));
      }
    },
  });
  const save = useMutation({
    mutationFn: (values: { valueId?: string; effectiveFrom: dayjs.Dayjs; reason: string }) =>
      parityApi.changePosition(employeeId, { attribute: attribute.key, valueId: values.valueId ?? null, effectiveFrom: values.effectiveFrom.format("YYYY-MM-DD"), reason: values.reason.trim() }),
    onSuccess: (data) => {
      queryClient.setQueryData(["employees", "position", employeeId], data);
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      void queryClient.invalidateQueries({ queryKey: ["employees", "history", employeeId] });
      toast.success(`${attribute.label} change saved.`);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save the change.")),
  });
  const clearable = CLEARABLE.includes(attribute.key);
  return (
    <SideDrawer open title={`Change ${attribute.label.toLowerCase()}`} subtitle={attribute.current ? `Now: ${attribute.current.value}` : undefined} onClose={onClose} formId="position-change-form" primaryLabel="Save" primaryLoading={save.isPending}>
      <Form id="position-change-form" form={form} layout="vertical" requiredMark={false} initialValues={{ effectiveFrom: dayjs() }} onFinish={(values) => save.mutate(values)}>
        <Form.Item name="valueId" label={`New ${attribute.label.toLowerCase()}`} rules={clearable ? [] : [{ required: true, message: `Choose a ${attribute.label.toLowerCase()}.` }]} extra={clearable ? "Leave empty to set it to Not set." : undefined}>
          <Select allowClear={clearable} showSearch={{ optionFilterProp: "label" }} loading={options.isLoading} options={options.data ?? []} placeholder={clearable ? "Not set" : "Choose"} />
        </Form.Item>
        <Form.Item name="effectiveFrom" label="Effective from" rules={[{ required: true }]} extra={<EffectiveDateHint value={effectiveFrom} />}>
          <DatePicker style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true, whitespace: true, min: 3, message: "Say why (a few words)." }]}>
          <Input.TextArea rows={2} maxLength={300} showCount />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

export function PositionTab({ employeeId }: { employeeId: string }) {
  const { hasPermission } = useAuth();
  const position = useQuery({ queryKey: ["employees", "position", employeeId], queryFn: () => parityApi.getPosition(employeeId) });
  const [changing, setChanging] = useState<parityApi.PositionHistory["attributes"][number] | null>(null);
  const mayChange = (key: parityApi.PositionAttribute) => (key === "shift" ? hasPermission("attendance.config.manage") : hasPermission("employee.edit"));
  return (
    <SectionStack>
      <QueryState isLoading={position.isLoading} error={position.error} onRetry={() => void position.refetch()} skeleton={<SkeletonCard lines={6} />}>
        <CardGrid min={280}>
          {(position.data?.attributes ?? []).map((a) => (
            <ProfileSection
              key={a.key}
              title={a.label}
              extra={
                mayChange(a.key) ? (
                  <Button icon={<PlusOutlined />} onClick={() => setChanging(a)} aria-label={`Change ${a.label.toLowerCase()}`}>
                    Change
                  </Button>
                ) : undefined
              }
            >
              <div style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>{a.current?.value ?? "Not set"}</div>
              <div style={{ fontSize: fs.sm, color: v.textSecondary, marginBottom: space[3] }}>{a.current ? `Since ${a.current.effectiveFrom}` : "No value in force today"}</div>
              <Timeline
                empty={<EmptyState compact title="No history yet." description={null} />}
                items={a.entries.map((e) => ({
                  key: `${a.key}-${e.effectiveFrom}`,
                  tone: TONE[e.status],
                  content: (
                    <span style={{ display: "inline-flex", gap: space[2], alignItems: "center", flexWrap: "wrap" }}>
                      <strong>{e.value}</strong> <StatusChip status={e.status} />
                    </span>
                  ),
                  time: `From ${e.effectiveFrom}${e.effectiveTo ? ` until ${e.effectiveTo}` : ""}`,
                  detail: e.reason ? <span style={{ color: v.textSecondary, fontSize: fs.sm }}>Reason: {e.reason}</span> : undefined,
                }))}
              />
            </ProfileSection>
          ))}
        </CardGrid>
      </QueryState>
      {changing && <ChangeDrawer employeeId={employeeId} attribute={changing} onClose={() => setChanging(null)} />}
    </SectionStack>
  );
}
