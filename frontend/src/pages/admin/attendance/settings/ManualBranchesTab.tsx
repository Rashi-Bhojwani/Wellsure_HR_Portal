import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Select } from "antd";
import { EditOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import type { ManualBranchHolder } from "../../../../api/attendance";
import * as orgApi from "../../../../api/org";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ApprovalBanner, DataTable, EmptyState, Panel, SideDrawer, StatusChip, toast, useIsPhone } from "../../../../ui";
import { fs, fw, space, v } from "../../../../theme/tokens";

const chips = { display: "inline-flex", flexWrap: "wrap" as const, gap: space[1] };

function BranchesCell({ h }: { h: ManualBranchHolder }) {
  if (h.allBranches) return <StatusChip tone="info">Every branch (company-wide)</StatusChip>;
  if (h.branches.length === 0) return <StatusChip tone="warning">No branches yet — they can't mark anyone</StatusChip>;
  return (
    <span style={chips}>
      {h.branches.map((b) => (
        <StatusChip key={b.id} tone="purple">
          {b.name}
        </StatusChip>
      ))}
    </span>
  );
}

function RolesCell({ roles }: { roles: string[] }) {
  return (
    <span style={chips}>
      {roles.map((x) => (
        <StatusChip key={x} tone="neutral">
          {x}
        </StatusChip>
      ))}
    </span>
  );
}

// Who may mark attendance by hand, and for which branches (D4, user
// 2026-10-08): "Mark attendance manually" is limited to the branches chosen
// here; company-wide HR marks every branch.
export function ManualBranchesTab() {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["attendance", "config", "manual-branches"], queryFn: attendanceApi.listManualBranchHolders });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const [editing, setEditing] = useState<{ holder: ManualBranchHolder; locationIds: string[] } | null>(null);
  const save = useMutation({
    mutationFn: (val: { userId: string; locationIds: string[] }) => attendanceApi.setManualBranches(val.userId, val.locationIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config", "manual-branches"] });
      toast.success("Branches saved.");
      setEditing(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the branches.")),
  });
  const noMachine = locations.filter((l) => l.isActive && !l.hasBiometricDevice);
  const action = (h: ManualBranchHolder) =>
    !h.allBranches && (
      <Button size={phone ? "middle" : "small"} icon={<EditOutlined />} onClick={() => setEditing({ holder: h, locationIds: h.branches.map((b) => b.id) })}>
        Choose branches
      </Button>
    );

  return (
    <>
      <ApprovalBanner
        tone="info"
        title="Who marks attendance by hand"
        description={
          <>
            Everyone who holds <b>Mark attendance manually</b> is listed. HR with company-wide access marks every branch; anyone else — such as a manager given the
            permission in Manager Management — marks only the branches chosen here, and is refused everywhere else.
            {noMachine.length > 0 && <> Branches with no biometric machine: {noMachine.map((l) => l.name).join(", ")}.</>}
          </>
        }
      />
      <Panel title="Manual-entry branches" subtitle={!isLoading ? `${data.length} ${data.length === 1 ? "person holds" : "people hold"} the permission` : undefined}>
        <DataTable<ManualBranchHolder>
          rowKey="userId"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data}
          pagination={false}
          empty={<EmptyState compact title="Nobody marks attendance by hand" description="Give someone Mark attendance manually in Roles or Manager Management, and they appear here." />}
          columns={[
            {
              title: "Person",
              key: "who",
              render: (_, h) => (
                <div>
                  <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{h.fullName}</div>
                  <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{h.employeeCode}</div>
                </div>
              ),
            },
            { title: "Roles", dataIndex: "roles", render: (r: string[]) => <RolesCell roles={r} /> },
            { title: "May mark", key: "branches", render: (_, h) => <BranchesCell h={h} /> },
            { title: "", key: "actions", render: (_, h) => action(h) },
          ]}
          mobile={{
            title: (h) => h.fullName,
            subtitle: (h) => h.employeeCode,
            fields: [
              { label: "May mark", render: (h) => <BranchesCell h={h} /> },
              { label: "Roles", render: (h) => <RolesCell roles={h.roles} /> },
            ],
            actions: (h) => action(h) || null,
          }}
        />
      </Panel>
      <SideDrawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.holder.fullName} (${editing.holder.employeeCode})` : ""}
        subtitle="The branches this person may mark attendance for by hand"
        primaryLabel="Save"
        primaryLoading={save.isPending}
        onPrimary={() => editing && save.mutate({ userId: editing.holder.userId, locationIds: editing.locationIds })}
      >
        <Form layout="vertical">
          <Form.Item label="Branches" extra="With none chosen, they can't mark anyone." htmlFor="manual-branches-select">
            <Select
              id="manual-branches-select"
              mode="multiple"
              autoFocus
              value={editing?.locationIds ?? []}
              onChange={(x) => editing && setEditing({ ...editing, locationIds: x })}
              options={locations.filter((l) => l.isActive).map((l) => ({ value: l.id, label: `${l.name}${l.hasBiometricDevice ? "" : " (no machine)"}` }))}
              aria-label="Branches this person may mark"
              placeholder="Choose branches"
            />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
