import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form } from "antd";
import { LinkOutlined } from "@ant-design/icons";
import * as biometricApi from "../../../api/biometric";
import type { PersonWithoutMapping, UnmappedRow } from "../../../api/biometric";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, space, v } from "../../../theme/tokens";
import { DataTable, EmptyState, SideDrawer, Stack, toast } from "../../../ui";
import { invalidateBiometric, when } from "./deviceLabels";

const MAP_FORM = "map-device-user-form";

function MapDrawer({ row, onClose }: { row: UnmappedRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [form] = Form.useForm<{ employeeId: string; effectiveFrom?: dayjs.Dayjs }>();
  const map = useMutation({
    mutationFn: (val: { employeeId: string; effectiveFrom?: dayjs.Dayjs }) => biometricApi.mapUnmapped({ deviceUserId: row!.deviceUserId, employeeId: val.employeeId, effectiveFrom: val.effectiveFrom?.format("YYYY-MM-DD") }),
    onSuccess: (r) => {
      invalidateBiometric(qc);
      toast.success(`Mapped from ${dayjs(r.mapping.validFrom).format("D MMM YYYY")}: ${r.resolved} punch(es) now counted${r.stillUnmapped ? `, ${r.stillUnmapped} still unmapped (before they joined)` : ""}.`);
      form.resetFields();
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not map this device ID.")),
  });
  return (
    <SideDrawer open={!!row} onClose={onClose} title={`Map device user ID ${row?.deviceUserId ?? ""}`} formId={MAP_FORM} primaryLabel="Map" primaryLoading={map.isPending}>
      <p style={{ color: v.textSecondary, fontSize: fs.md, marginTop: 0 }}>
        {row?.punches} punch(es) from {row ? dayjs(row.firstAt).format("D MMM YYYY") : ""}. The mapping starts on the first of them (or the date you choose, never before they joined), the punches are given to
        this person, and their days are recomputed. One device ID is never two people on the same day.
      </p>
      <Form id={MAP_FORM} form={form} layout="vertical" requiredMark={false} onFinish={(val) => map.mutate(val)}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: "Choose the employee" }]}>
          <EmployeePicker />
        </Form.Item>
        <Form.Item name="effectiveFrom" label="From (optional)">
          <DatePicker format="D MMM YYYY" style={{ width: "100%" }} />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

/** People at a branch that has a machine but who have no device user ID: if they punch, it lands above; and on a day they are expected they look absent. */
function PeopleWithoutMapping() {
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["biometric", "people-without-mapping"], queryFn: biometricApi.listPeopleWithoutMapping });
  return (
    <section aria-labelledby="people-without-mapping" style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
      <h3 id="people-without-mapping" style={{ margin: 0, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>
        People at branches with a machine but no device user ID
      </h3>
      <p style={{ margin: `0 0 ${space[2]}px`, color: v.textSecondary, fontSize: fs.md }}>
        Employed today, placed at a branch that has an active biometric device, and with no device user ID mapped. Map their ID from the employee&apos;s record (Attendance capture).
      </p>
      <DataTable<PersonWithoutMapping>
        density="compact"
        rowKey="employeeId"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={data}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        empty={<EmptyState compact illustration="people" title="Everyone at a branch with a machine has a device user ID." description={null} />}
        columns={[
          { title: "Employee code", dataIndex: "employeeCode" },
          { title: "Branch", dataIndex: "branch" },
        ]}
        mobile={{ title: (r) => r.employeeCode, subtitle: (r) => r.branch }}
      />
    </section>
  );
}

export function UnmappedTab() {
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["biometric", "unmapped"], queryFn: biometricApi.listUnmapped });
  const [mapping, setMapping] = useState<UnmappedRow | null>(null);
  return (
    <Stack gap={space[6]}>
      <section style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
        <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.md }}>Punches whose device user ID nobody had on that day. They are kept, never discarded, and counted as soon as the ID is mapped.</p>
        <DataTable<UnmappedRow>
          rowKey="deviceUserId"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data}
          pagination={false}
          empty={<EmptyState compact title="No unmapped punches." description="Every punch so far belongs to someone." />}
          columns={[
            { title: "Device user ID", dataIndex: "deviceUserId" },
            { title: "Punches", dataIndex: "punches", align: "right" },
            { title: "First", dataIndex: "firstAt", render: when },
            { title: "Latest", dataIndex: "lastAt", render: when },
            { title: "Devices", dataIndex: "devices", render: (d: string[]) => d.join(", ") },
            {
              title: "",
              key: "actions",
              align: "right",
              render: (_, r) => (
                <Button size="small" type="primary" icon={<LinkOutlined />} onClick={() => setMapping(r)}>
                  Map to employee
                </Button>
              ),
            },
          ]}
          mobile={{
            title: (r) => `Device user ID ${r.deviceUserId}`,
            subtitle: (r) => r.devices.join(", "),
            fields: [
              { label: "Punches", render: (r) => r.punches },
              { label: "First", render: (r) => when(r.firstAt) },
              { label: "Latest", render: (r) => when(r.lastAt) },
            ],
            actions: (r) => (
              <Button block type="primary" icon={<LinkOutlined />} onClick={() => setMapping(r)}>
                Map to employee
              </Button>
            ),
          }}
        />
      </section>
      <MapDrawer row={mapping} onClose={() => setMapping(null)} />
      <PeopleWithoutMapping />
    </Stack>
  );
}
