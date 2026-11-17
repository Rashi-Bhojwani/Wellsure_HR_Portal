import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input } from "antd";
import * as employeeApi from "../../../api/employee";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { ApprovalBanner, SideDrawer, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Employee-number login (docs/plans/LOGIN_CHECKLIST.md, owner decision 2026-11-17): the employee number is the person's login ID and must be the
// same as their ID on the attendance machine. This panel says so, warns when the machine ID differs, tells HR when there is no email on record (so
// no link can reach them), and lets a director (only) change the number, with a reason.

export function LoginIdNotices({ profile }: { profile: employeeApi.EmployeeProfile }) {
  return (
    <>
      {profile.loginIdMatchesMachine === false && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: space[4] }}
          title={`The attendance machine ID (${profile.deviceUserId ?? "—"}) is not the same as the employee number (${profile.employeeCode})`}
          description="They must match: the employee number is the login ID and the ID on the machine. Change the ID on the machine, or ask a director to change the employee number."
          data-testid="login-machine-mismatch"
        />
      )}
      {profile.noEmailOnRecord && (
        <ApprovalBanner
          tone="danger"
          style={{ marginTop: space[4] }}
          title={`No email on record for employee ${profile.employeeCode}`}
          description={
            profile.emailMissingRequestedAt
              ? `A password link was asked for on ${new Date(profile.emailMissingRequestedAt).toLocaleString()} but nothing could be sent. Add their personal email, then send a setup link.`
              : "No password or setup link can reach them. Add their personal email, then send a setup link."
          }
        />
      )}
    </>
  );
}

export function LoginIdLabel({ profile }: { profile: employeeApi.EmployeeProfile }) {
  return <>{profile.attendanceCapture === "DEVICE" ? "Login ID and attendance machine ID" : "Login ID (employee number)"}</>;
}

/** "Change employee number", shown to directors only (the server checks again). */
export function ChangeEmployeeCodeButton({ profile }: { profile: employeeApi.EmployeeProfile }) {
  const { hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  if (!hasRole("SUPER_ADMIN")) return null;
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)} data-testid="change-employee-code">
        Change employee number
      </Button>
      <ChangeEmployeeCodeDrawer profile={profile} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ChangeEmployeeCodeDrawer({ profile, open, onClose }: { profile: employeeApi.EmployeeProfile; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ employeeCode: string; reason: string }>();
  const mutation = useMutation({
    mutationFn: (values: { employeeCode: string; reason: string }) => employeeApi.changeEmployeeCode(profile.id, values.employeeCode.trim(), values.reason.trim()),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", profile.id] });
      onClose();
      toast.success(`Employee number changed from ${result.previousEmployeeCode} to ${result.employeeCode}. ${result.warning}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not change the employee number.")),
  });

  return (
    <SideDrawer title="Change employee number" open={open} onClose={onClose} formId="employee-code-form" primaryLabel="Change number" primaryLoading={mutation.isPending} primaryDanger>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: space[5] }}
        title="This is their login ID and must match the attendance machine"
        description={`They will sign in with the new number from now on. Change the ID on the attendance machine to the same number${profile.deviceUserId ? ` (it is ${profile.deviceUserId} now)` : ""}, or their punches will not reach them.`}
      />
      <Form id="employee-code-form" form={form} layout="vertical" requiredMark={false} onFinish={(values) => mutation.mutate(values)}>
        <Form.Item label="Current number">
          <Input value={profile.employeeCode} disabled />
        </Form.Item>
        <Form.Item
          name="employeeCode"
          label="New employee number"
          rules={[
            { required: true, whitespace: true, message: "Enter the new number" },
            { max: 30, message: "At most 30 characters" },
          ]}
          extra="Text: leading zeros and letters are kept. Upper and lower case count as the same number."
        >
          <Input autoComplete="off" spellCheck={false} />
        </Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true, whitespace: true, min: 3, message: "Say why (at least 3 characters)" }, { max: 300 }]}>
          <Input.TextArea rows={3} placeholder="e.g. The number on the machine was entered wrongly" />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}
