import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Select, Space, Table, Tag, Typography, message } from "antd";
import { EditOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import type { ManualBranchHolder } from "../../../../api/attendance";
import * as orgApi from "../../../../api/org";
import { apiErrorMessage } from "../../../../lib/apiError";

const { Text } = Typography;

// Who may mark attendance by hand, and for which branches (D4, user
// 2026-10-08): "Mark attendance manually" is limited to the branches chosen
// here; company-wide HR marks every branch.
export function ManualBranchesTab() {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["attendance", "config", "manual-branches"], queryFn: attendanceApi.listManualBranchHolders });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const [editing, setEditing] = useState<{ userId: string; locationIds: string[] } | null>(null);
  const save = useMutation({
    mutationFn: (v: { userId: string; locationIds: string[] }) => attendanceApi.setManualBranches(v.userId, v.locationIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config", "manual-branches"] });
      void message.success("Branches saved.");
      setEditing(null);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save the branches.")),
  });
  const noMachine = locations.filter((l) => l.isActive && !l.hasBiometricDevice);
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        title="Who marks attendance by hand"
        description={
          <>
            Everyone who holds <b>Mark attendance manually</b> is listed. HR with company-wide access marks every branch; anyone else — such as a manager
            given the permission in Manager Management — marks only the branches chosen here, and is refused everywhere else.
            {noMachine.length > 0 && <> Branches with no biometric machine: {noMachine.map((l) => l.name).join(", ")}.</>}
          </>
        }
      />
      <Table<ManualBranchHolder>
        rowKey="userId"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: "Person", key: "who", render: (_, h) => <><Text strong>{h.fullName}</Text> <Text type="secondary">{h.employeeCode}</Text></> },
          { title: "Roles", dataIndex: "roles", render: (r: string[]) => r.map((x) => <Tag key={x}>{x}</Tag>) },
          {
            title: "May mark",
            key: "branches",
            render: (_, h) =>
              h.allBranches ? (
                <Tag color="blue">Every branch (company-wide)</Tag>
              ) : editing?.userId === h.userId ? (
                <Select
                  mode="multiple"
                  autoFocus
                  style={{ minWidth: 280 }}
                  value={editing.locationIds}
                  onChange={(v) => setEditing({ userId: h.userId, locationIds: v })}
                  options={locations.filter((l) => l.isActive).map((l) => ({ value: l.id, label: `${l.name}${l.hasBiometricDevice ? "" : " (no machine)"}` }))}
                  aria-label="Branches this person may mark"
                />
              ) : h.branches.length ? (
                h.branches.map((b) => <Tag key={b.id} color="purple">{b.name}</Tag>)
              ) : (
                <Text type="warning">No branches yet — they can't mark anyone</Text>
              ),
          },
          {
            title: "",
            key: "actions",
            render: (_, h) =>
              !h.allBranches &&
              (editing?.userId === h.userId ? (
                <Space>
                  <Button size="small" type="primary" loading={save.isPending} onClick={() => save.mutate(editing)}>Save</Button>
                  <Button size="small" onClick={() => setEditing(null)}>Cancel</Button>
                </Space>
              ) : (
                <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ userId: h.userId, locationIds: h.branches.map((b) => b.id) })}>Choose branches</Button>
              )),
          },
        ]}
      />
    </Space>
  );
}
