import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Descriptions, Form, Input, Modal, Space, Tabs, Tag, Typography, message } from "antd";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as employeeApi from "../../../api/employee";
import { EmptyState } from "../../../components/common/EmptyState";
import { PhotoUploader } from "../../../components/common/PhotoUploader";
import * as peopleApi from "../../../api/people";

const { Title } = Typography;

type ChangeRequestFieldGroup = "bank" | "statutory" | "personal";

function RequestChangeModal({ open, fieldGroup, onClose }: { open: boolean; fieldGroup: ChangeRequestFieldGroup | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const mutation = useMutation({
    mutationFn: (changes: Record<string, unknown>) => employeeApi.createChangeRequest({ fieldGroup: fieldGroup!, changes } as employeeApi.CreateChangeRequestInput),
    onSuccess: () => {
      onClose();
      void message.success("Change request submitted — HR will review it.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not submit request.")),
  });

  return (
    <Modal title="Request a change" open={open} onCancel={onClose} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)} requiredMark={false}>
        {fieldGroup === "personal" && (
          <>
            <Form.Item name="mobile" label="New mobile number"><Input /></Form.Item>
            <Form.Item name="personalEmail" label="New personal email (Gmail)"><Input /></Form.Item>
            <Form.Item name="bloodGroup" label="Blood group"><Input /></Form.Item>
          </>
        )}
        {fieldGroup === "statutory" && (
          <>
            <Form.Item name="pan" label="PAN"><Input /></Form.Item>
            <Form.Item name="aadhaar" label="Aadhaar"><Input /></Form.Item>
            <Form.Item name="uan" label="UAN"><Input /></Form.Item>
            <Form.Item name="esiNumber" label="ESI Number"><Input /></Form.Item>
          </>
        )}
        {fieldGroup === "bank" && (
          <>
            <Form.Item name="accountHolderName" label="Account Holder Name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="accountNumber" label="New Account Number" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item
              name="accountNumberConfirm"
              label="Confirm Account Number"
              dependencies={["accountNumber"]}
              rules={[{ required: true }, ({ getFieldValue }) => ({ validator(_, value) { return value === getFieldValue("accountNumber") ? Promise.resolve() : Promise.reject(new Error("Doesn't match.")); } })]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="ifsc" label="IFSC" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="bankName" label="Bank Name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="branchName" label="Branch Name" rules={[{ required: true }]}><Input /></Form.Item>
          </>
        )}
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>Submit for HR approval</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function EditSelfServiceModal({ open, profile, onClose }: { open: boolean; profile: employeeApi.EmployeeProfile; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => employeeApi.updateSelfService(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "me"] });
      onClose();
      void message.success("Updated.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not update.")),
  });

  return (
    <Modal title="Edit address & emergency contact" open={open} onCancel={onClose} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)} requiredMark={false} initialValues={profile.personal ?? {}}>
        <Form.Item name="currentAddress" label="Current Address"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="permanentAddress" label="Permanent Address"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="emergencyContactName" label="Emergency Contact Name"><Input /></Form.Item>
        <Form.Item name="emergencyContactPhone" label="Emergency Contact Phone"><Input /></Form.Item>
        <Form.Item name="emergencyContactRelation" label="Relation"><Input /></Form.Item>
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>Save</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function ViewMyInfoPage() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useQuery({ queryKey: ["employees", "me"], queryFn: employeeApi.getMyProfile });
  const [editOpen, setEditOpen] = useState(false);
  const [requestGroup, setRequestGroup] = useState<ChangeRequestFieldGroup | null>(null);

  if (isLoading || !profile) return <EmptyState message="Loading…" />;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>My Info</Title>
      {profile.personal && (
        <Card size="small">
          <PhotoUploader
            employeeId={profile.id}
            name={profile.fullName}
            photoVersion={profile.personal.photoVersion}
            upload={peopleApi.uploadMyPhoto}
            remove={peopleApi.removeMyPhoto}
            onChanged={() => {
              void queryClient.invalidateQueries({ queryKey: ["employees", "me"] });
              void queryClient.invalidateQueries({ queryKey: ["people"] });
            }}
          />
        </Card>
      )}
      <Card>
        <Tabs
          items={[
            {
              key: "official",
              label: "Official",
              children: (
                <Descriptions column={2} bordered size="small">
                  <Descriptions.Item label="Employee Code">{profile.employeeCode}</Descriptions.Item>
                  <Descriptions.Item label="Status"><Tag color="green">{profile.status}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Date of Joining">{profile.dateOfJoining}</Descriptions.Item>
                  <Descriptions.Item label="Department">{profile.job?.department.name ?? "—"}</Descriptions.Item>
                  <Descriptions.Item label="Designation">{profile.job?.designation.name ?? "—"}</Descriptions.Item>
                  <Descriptions.Item label="Location">{profile.job?.location.name ?? "—"}</Descriptions.Item>
                  <Descriptions.Item label="Reporting Manager">{profile.job?.reportingManager?.fullName ?? "—"}</Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "personal",
              label: "Personal",
              children: profile.personal ? (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="Date of Birth">{profile.personal.dateOfBirth}</Descriptions.Item>
                    <Descriptions.Item label="Gender">{profile.personal.gender}</Descriptions.Item>
                    <Descriptions.Item label="Personal Email">{profile.personal.personalEmail}</Descriptions.Item>
                    <Descriptions.Item label="Mobile">{profile.personal.mobile}</Descriptions.Item>
                    <Descriptions.Item label="Current Address" span={2}>{profile.personal.currentAddress}</Descriptions.Item>
                    <Descriptions.Item label="Permanent Address" span={2}>{profile.personal.permanentAddress}</Descriptions.Item>
                    <Descriptions.Item label="Emergency Contact">{profile.personal.emergencyContactName} ({profile.personal.emergencyContactRelation})</Descriptions.Item>
                    <Descriptions.Item label="Emergency Phone">{profile.personal.emergencyContactPhone}</Descriptions.Item>
                    <Descriptions.Item label="Blood Group">{profile.personal.bloodGroup ?? "—"}</Descriptions.Item>
                  </Descriptions>
                  <Space>
                    <Button onClick={() => setEditOpen(true)}>Edit address / emergency contact</Button>
                    <Button onClick={() => setRequestGroup("personal")}>Request other changes</Button>
                  </Space>
                </Space>
              ) : (
                <EmptyState message="No personal details on file." />
              ),
            },
            {
              key: "statutory",
              label: "Statutory",
              children: profile.statutory ? (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="PAN">{profile.statutory.hasPan ? `••••${profile.statutory.panLast4}` : "—"}</Descriptions.Item>
                    <Descriptions.Item label="Aadhaar">{profile.statutory.hasAadhaar ? `••••${profile.statutory.aadhaarLast4}` : "—"}</Descriptions.Item>
                    <Descriptions.Item label="UAN">{profile.statutory.hasUan ? `••••${profile.statutory.uanLast4}` : "—"}</Descriptions.Item>
                    <Descriptions.Item label="ESI Number">{profile.statutory.esiNumber ?? "—"}</Descriptions.Item>
                  </Descriptions>
                  <Button onClick={() => setRequestGroup("statutory")}>Request a change</Button>
                </Space>
              ) : (
                <EmptyState message="No statutory details on file." />
              ),
            },
            {
              key: "bank",
              label: "Bank",
              children: profile.bank ? (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  <Descriptions column={2} bordered size="small">
                    <Descriptions.Item label="Account Holder">{profile.bank.accountHolderName}</Descriptions.Item>
                    <Descriptions.Item label="Account Number">••••{profile.bank.accountNumberLast4}</Descriptions.Item>
                    <Descriptions.Item label="IFSC">{profile.bank.ifsc}</Descriptions.Item>
                    <Descriptions.Item label="Bank">{profile.bank.bankName}</Descriptions.Item>
                  </Descriptions>
                  <Button onClick={() => setRequestGroup("bank")}>Request a change</Button>
                </Space>
              ) : (
                <EmptyState message="No bank account on file." />
              ),
            },
          ]}
        />
      </Card>

      <EditSelfServiceModal open={editOpen} profile={profile} onClose={() => setEditOpen(false)} />
      <RequestChangeModal open={requestGroup !== null} fieldGroup={requestGroup} onClose={() => setRequestGroup(null)} />
    </Space>
  );
}
