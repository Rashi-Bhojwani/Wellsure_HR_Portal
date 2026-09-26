import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { EyeOutlined, ExportOutlined as SeparateIcon } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import dayjs from "dayjs";
import * as employeeApi from "../../../api/employee";
import * as orgApi from "../../../api/org";
import { useAuth } from "../../../hooks/useAuth";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title, Text } = Typography;

function OfficialTab({ profile }: { profile: employeeApi.EmployeeProfile }) {
  return (
    <Descriptions column={2} bordered size="small">
      <Descriptions.Item label="Employee Code">{profile.employeeCode}</Descriptions.Item>
      <Descriptions.Item label="Status"><Tag color={profile.status === "ACTIVE" ? "green" : profile.status === "SEPARATED" ? "default" : "orange"}>{profile.status}</Tag></Descriptions.Item>
      <Descriptions.Item label="Date of Joining">{profile.dateOfJoining}</Descriptions.Item>
      <Descriptions.Item label="Last Working Date">{profile.lastWorkingDate ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="Employment Type">{profile.employmentType}</Descriptions.Item>
      <Descriptions.Item label="Official Email">{profile.officialEmail ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="Department">{profile.job?.department.name ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="Designation">{profile.job?.designation.name ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="Location">{profile.job?.location.name ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="Grade">{profile.job?.grade?.name ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="Cost Centre">{profile.job?.costCentre?.name ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="Reporting Manager">{profile.job?.reportingManager?.fullName ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="Account Status">{profile.accountStatus ?? "—"}</Descriptions.Item>
      <Descriptions.Item label="2FA">{profile.totpEnabled ? "Enabled" : "Not enabled"}</Descriptions.Item>
    </Descriptions>
  );
}

function PersonalTab({ profile }: { profile: employeeApi.EmployeeProfile }) {
  if (!profile.personal) return <EmptyState message="No personal details on file." />;
  const p = profile.personal;
  return (
    <Descriptions column={2} bordered size="small">
      <Descriptions.Item label="Date of Birth">{p.dateOfBirth}</Descriptions.Item>
      <Descriptions.Item label="Gender">{p.gender}</Descriptions.Item>
      <Descriptions.Item label="Personal Email">{p.personalEmail}</Descriptions.Item>
      <Descriptions.Item label="Mobile">{p.mobile}</Descriptions.Item>
      <Descriptions.Item label="Current Address" span={2}>{p.currentAddress}</Descriptions.Item>
      <Descriptions.Item label="Permanent Address" span={2}>{p.permanentAddress}</Descriptions.Item>
      <Descriptions.Item label="Emergency Contact">{p.emergencyContactName} ({p.emergencyContactRelation})</Descriptions.Item>
      <Descriptions.Item label="Emergency Phone">{p.emergencyContactPhone}</Descriptions.Item>
      <Descriptions.Item label="Blood Group">{p.bloodGroup ?? "—"}</Descriptions.Item>
    </Descriptions>
  );
}

function StatutoryTab({ employeeId, profile, canEdit }: { employeeId: string; profile: employeeApi.EmployeeProfile; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<Awaited<ReturnType<typeof employeeApi.revealStatutory>> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form] = Form.useForm();

  const revealMutation = useMutation({
    mutationFn: () => employeeApi.revealStatutory(employeeId),
    onSuccess: setRevealed,
    onError: (err) => void message.error(errorMessage(err, "Could not reveal statutory details.")),
  });
  const saveMutation = useMutation({
    mutationFn: (values: { pan?: string; aadhaar?: string; uan?: string; esiNumber?: string }) => employeeApi.updateStatutory(employeeId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      setEditOpen(false);
      void message.success("Statutory details updated.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not update.")),
  });

  if (profile.statutory === undefined) return <EmptyState message="You don't have permission to view statutory details." />;
  if (profile.statutory === null) return <EmptyState message="No statutory details on file." />;

  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="PAN">{revealed?.pan ?? (profile.statutory.hasPan ? `••••${profile.statutory.panLast4}` : "—")}</Descriptions.Item>
        <Descriptions.Item label="Aadhaar">{revealed?.aadhaar ?? (profile.statutory.hasAadhaar ? `••••${profile.statutory.aadhaarLast4}` : "—")}</Descriptions.Item>
        <Descriptions.Item label="UAN">{revealed?.uan ?? (profile.statutory.hasUan ? `••••${profile.statutory.uanLast4}` : "—")}</Descriptions.Item>
        <Descriptions.Item label="ESI Number">{profile.statutory.esiNumber ?? "—"}</Descriptions.Item>
      </Descriptions>
      <Space>
        <Button icon={<EyeOutlined />} loading={revealMutation.isPending} onClick={() => revealMutation.mutate()}>
          Reveal full details
        </Button>
        {canEdit && (
          <Button
            onClick={() => {
              form.resetFields();
              setEditOpen(true);
            }}
          >
            Edit
          </Button>
        )}
      </Space>
      <Modal title="Edit statutory details" open={editOpen} onCancel={() => setEditOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} requiredMark={false}>
          <Form.Item name="pan" label="PAN"><Input /></Form.Item>
          <Form.Item name="aadhaar" label="Aadhaar"><Input /></Form.Item>
          <Form.Item name="uan" label="UAN"><Input /></Form.Item>
          <Form.Item name="esiNumber" label="ESI Number"><Input /></Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>Save</Button>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function BankTab({ employeeId, profile, canEdit }: { employeeId: string; profile: employeeApi.EmployeeProfile; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<Awaited<ReturnType<typeof employeeApi.revealBank>> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form] = Form.useForm();

  const revealMutation = useMutation({
    mutationFn: () => employeeApi.revealBank(employeeId),
    onSuccess: setRevealed,
    onError: (err) => void message.error(errorMessage(err, "Could not reveal bank details.")),
  });
  const saveMutation = useMutation({
    mutationFn: (values: { accountHolderName: string; accountNumber: string; accountNumberConfirm: string; ifsc: string; bankName: string; branchName: string }) =>
      employeeApi.updateBank(employeeId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      setEditOpen(false);
      void message.success("Bank details updated — the previous account is closed as of today, this one is now active.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not update.")),
  });

  if (profile.bank === undefined) return <EmptyState message="You don't have permission to view bank details." />;
  if (profile.bank === null) return <EmptyState message="No bank account on file." />;

  return (
    <Space orientation="vertical" style={{ width: "100%" }}>
      <Descriptions column={2} bordered size="small">
        <Descriptions.Item label="Account Holder">{profile.bank.accountHolderName}</Descriptions.Item>
        <Descriptions.Item label="Account Number">{revealed?.accountNumber ?? `••••${profile.bank.accountNumberLast4}`}</Descriptions.Item>
        <Descriptions.Item label="IFSC">{profile.bank.ifsc}</Descriptions.Item>
        <Descriptions.Item label="Bank">{profile.bank.bankName}</Descriptions.Item>
        <Descriptions.Item label="Branch">{profile.bank.branchName}</Descriptions.Item>
        <Descriptions.Item label="Effective From">{profile.bank.effectiveFrom}</Descriptions.Item>
      </Descriptions>
      <Space>
        <Button icon={<EyeOutlined />} loading={revealMutation.isPending} onClick={() => revealMutation.mutate()}>
          Reveal full account number
        </Button>
        {canEdit && (
          <Button
            onClick={() => {
              form.resetFields();
              setEditOpen(true);
            }}
          >
            Change bank account
          </Button>
        )}
      </Space>
      <Modal title="Change bank account" open={editOpen} onCancel={() => setEditOpen(false)} footer={null} destroyOnHidden>
        <Alert type="info" showIcon style={{ marginBottom: 16 }} message="This closes the current account (effective today) and opens the new one." />
        <Form form={form} layout="vertical" onFinish={(v) => saveMutation.mutate(v)} requiredMark={false}>
          <Form.Item name="accountHolderName" label="Account Holder Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="accountNumber" label="Account Number" rules={[{ required: true }]}><Input /></Form.Item>
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
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>Save</Button>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

function JobEditModal({ employeeId, open, onClose }: { employeeId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list });
  const { data: designations = [] } = useQuery({ queryKey: ["org", "designations"], queryFn: orgApi.designations.list });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(false) });

  const mutation = useMutation({
    mutationFn: (values: { departmentId?: string; designationId?: string; locationId?: string; effectiveFrom: dayjs.Dayjs; changeReason?: string }) =>
      employeeApi.updateJob(employeeId, { ...values, effectiveFrom: values.effectiveFrom.format("YYYY-MM-DD") }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      void queryClient.invalidateQueries({ queryKey: ["employees", "history", employeeId, "job"] });
      onClose();
      void message.success("Job details updated.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not update job details.")),
  });

  return (
    <Modal title="Change job details" open={open} onCancel={onClose} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)} requiredMark={false} initialValues={{ effectiveFrom: dayjs() }}>
        <Form.Item name="departmentId" label="Department"><Select allowClear options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Form.Item>
        <Form.Item name="designationId" label="Designation"><Select allowClear options={designations.map((d) => ({ value: d.id, label: d.name }))} /></Form.Item>
        <Form.Item name="locationId" label="Location"><Select allowClear options={locations.map((l) => ({ value: l.id, label: l.name }))} /></Form.Item>
        <Form.Item name="effectiveFrom" label="Effective From" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="changeReason" label="Reason"><Input placeholder="e.g. Promotion, Transfer" /></Form.Item>
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>Save</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function HistoryTab({ employeeId, canViewBank }: { employeeId: string; canViewBank: boolean }) {
  const { data: jobHistory = [] } = useQuery({ queryKey: ["employees", "history", employeeId, "job"], queryFn: () => employeeApi.getJobHistory(employeeId) });
  const { data: nameHistory = [] } = useQuery({ queryKey: ["employees", "history", employeeId, "name"], queryFn: () => employeeApi.getNameHistory(employeeId) });
  const { data: bankHistory = [] } = useQuery({ queryKey: ["employees", "history", employeeId, "bank"], queryFn: () => employeeApi.getBankHistory(employeeId), enabled: canViewBank });

  return (
    <Space orientation="vertical" size={24} style={{ width: "100%" }}>
      <div>
        <Title level={5}>Job History</Title>
        <Table rowKey="id" size="small" pagination={false} dataSource={jobHistory} columns={[
          { title: "Department", dataIndex: "department" },
          { title: "Designation", dataIndex: "designation" },
          { title: "Location", dataIndex: "location" },
          { title: "Manager", dataIndex: "reportingManager", render: (v: string | null) => v ?? "—" },
          { title: "From", dataIndex: "effectiveFrom" },
          { title: "To", dataIndex: "effectiveTo", render: (v: string | null) => v ?? "Current" },
          { title: "Reason", dataIndex: "changeReason", render: (v: string | null) => v ?? "—" },
        ]} />
      </div>
      <div>
        <Title level={5}>Name History</Title>
        <Table rowKey="id" size="small" pagination={false} dataSource={nameHistory} columns={[
          { title: "Full Name", dataIndex: "fullName" },
          { title: "From", dataIndex: "effectiveFrom" },
          { title: "To", dataIndex: "effectiveTo", render: (v: string | null) => v ?? "Current" },
          { title: "Reason", dataIndex: "changeReason", render: (v: string | null) => v ?? "—" },
        ]} />
      </div>
      {canViewBank && (
        <div>
          <Title level={5}>Bank History</Title>
          <Table rowKey="id" size="small" pagination={false} dataSource={bankHistory} columns={[
            { title: "Bank", dataIndex: "bankName" },
            { title: "Account (last 4)", dataIndex: "accountNumberLast4" },
            { title: "IFSC", dataIndex: "ifsc" },
            { title: "From", dataIndex: "effectiveFrom" },
            { title: "To", dataIndex: "effectiveTo", render: (v: string | null) => v ?? "Current" },
          ]} />
        </div>
      )}
    </Space>
  );
}

function SeparationModal({ employeeId, open, onClose }: { employeeId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const mutation = useMutation({
    mutationFn: (values: { lastWorkingDate: dayjs.Dayjs; reason: string; notes?: string }) =>
      employeeApi.initiateSeparation(employeeId, { ...values, lastWorkingDate: values.lastWorkingDate.format("YYYY-MM-DD") }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      onClose();
      void message.success("Separation initiated. Login will be disabled automatically the day after the last working date.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not initiate separation.")),
  });
  return (
    <Modal title="Initiate separation" open={open} onCancel={onClose} footer={null} destroyOnHidden>
      <Form form={form} layout="vertical" onFinish={(v) => mutation.mutate(v)} requiredMark={false}>
        <Form.Item name="lastWorkingDate" label="Last Working Date" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" danger htmlType="submit" loading={mutation.isPending}>Initiate</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function EmployeeProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const [jobEditOpen, setJobEditOpen] = useState(false);
  const [separationOpen, setSeparationOpen] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ["employees", "profile", id],
    queryFn: () => employeeApi.getEmployeeProfile(id!),
    enabled: !!id,
  });

  if (isLoading || !profile) return <EmptyState message="Loading…" />;

  const canEdit = hasPermission("employee.edit");
  const canViewBank = hasPermission("employee.bank.view");
  const canSeparate = hasPermission("employee.separate");

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Title level={3} style={{ margin: 0 }}>
          {profile.fullName} <Text type="secondary" style={{ fontSize: 16 }}>({profile.employeeCode})</Text>
        </Title>
        <Space>
          {canEdit && <Button onClick={() => setJobEditOpen(true)}>Change job details</Button>}
          {canSeparate && profile.status === "ACTIVE" && (
            <Button danger icon={<SeparateIcon />} onClick={() => setSeparationOpen(true)}>
              Initiate Separation
            </Button>
          )}
        </Space>
      </Space>

      <Card>
        <Tabs
          items={[
            { key: "official", label: "Official", children: <OfficialTab profile={profile} /> },
            { key: "personal", label: "Personal", children: <PersonalTab profile={profile} /> },
            { key: "statutory", label: "Statutory", children: <StatutoryTab employeeId={id!} profile={profile} canEdit={hasPermission("employee.statutory.edit")} /> },
            { key: "bank", label: "Bank", children: <BankTab employeeId={id!} profile={profile} canEdit={hasPermission("employee.bank.edit")} /> },
            { key: "history", label: "History", children: <HistoryTab employeeId={id!} canViewBank={canViewBank} /> },
          ]}
        />
      </Card>

      <JobEditModal employeeId={id!} open={jobEditOpen} onClose={() => setJobEditOpen(false)} />
      <SeparationModal employeeId={id!} open={separationOpen} onClose={() => setSeparationOpen(false)} />
    </Space>
  );
}
