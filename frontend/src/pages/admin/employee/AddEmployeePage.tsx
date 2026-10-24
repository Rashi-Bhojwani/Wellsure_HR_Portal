import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";
import { Alert, Button, DatePicker, Form, Input, Radio, Select, Space, Typography } from "antd";
import { ArrowLeftOutlined, ArrowRightOutlined, SendOutlined } from "@ant-design/icons";
import { FormGroupTitle, Illustration, PageHeader, Panel, Stack, StepperLayout, useIsPhone } from "../../../ui";
import { fs, fw, space, v } from "../../../theme/tokens";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import { InvitationStatus } from "../../../components/common/InvitationStatus";
import * as employeeApi from "../../../api/employee";
import * as managersApi from "../../../api/managers";
import * as orgApi from "../../../api/org";

const { Text } = Typography;

const STEPS = ["Official", "Personal", "Statutory", "Bank", "Review"];
const REFERENCE_STALE = 30_000;
const WIDE: CSSProperties = { gridColumn: "1 / -1" };

/** The drawer form's field grid (employees-03): two columns on desktop, one on phones. */
function FieldGrid({ children }: { children: ReactNode }) {
  const phone = useIsPhone();
  return <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))", columnGap: space[6] }}>{children}</div>;
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], padding: `${space[3]}px 0`, borderBottom: `1px solid ${v.borderDefault}` }}>
      <span style={{ color: v.textSecondary, fontSize: fs.md, minWidth: 160 }}>{label}</span>
      <span style={{ color: v.textBody, fontSize: fs.md, fontWeight: fw.medium, flex: 1, minWidth: 0, wordBreak: "break-word" }}>{children}</span>
    </div>
  );
}

export function AddEmployeePage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [form] = Form.useForm();
  const [current, setCurrent] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deviceCheck, setDeviceCheck] = useState<employeeApi.DeviceCodeCheckResult | null>(null);
  const [checkingDevice, setCheckingDevice] = useState(false);
  // Once the employee exists, the screen tells HR what really happened to the invitation email instead of jumping away.
  const [created, setCreated] = useState<employeeApi.CreatedEmployee | null>(null);

  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, staleTime: REFERENCE_STALE });
  const { data: designations = [] } = useQuery({ queryKey: ["org", "designations"], queryFn: orgApi.designations.list, staleTime: REFERENCE_STALE });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(false), staleTime: REFERENCE_STALE });
  const { data: grades = [] } = useQuery({ queryKey: ["org", "grades"], queryFn: orgApi.grades.list, staleTime: REFERENCE_STALE });
  const { data: costCentres = [] } = useQuery({ queryKey: ["org", "cost-centres"], queryFn: orgApi.costCentres.list, staleTime: REFERENCE_STALE });
  // E2 (model A): only active managers can be someone's reporting manager.
  const { data: managerOptions = [] } = useQuery({ queryKey: ["managers", "options"], queryFn: managersApi.managerOptions });

  async function onDeviceUserIdChange(value: string) {
    form.setFieldValue("official", { ...form.getFieldValue("official"), employeeCode: value });
    setDeviceCheck(null);
    if (!value.trim()) return;
    setCheckingDevice(true);
    try {
      const result = await employeeApi.checkDeviceCode(value.trim());
      setDeviceCheck(result);
      if (result.collision) {
        form.setFieldValue(["official", "employeeCode"], result.suggestedEmployeeCode);
      }
    } catch {
      // non-fatal — HR can still proceed, the create call re-validates
    } finally {
      setCheckingDevice(false);
    }
  }

  // Phase 2 (D2, user 2026-10-08): attendance capture is a deliberate choice,
  // defaulted from the branch (has it a biometric machine?) until HR picks.
  const locationId = Form.useWatch(["official", "locationId"], form) as string | undefined;
  const capture = (Form.useWatch(["official", "attendanceCapture"], form) as "DEVICE" | "MANUAL" | undefined) ?? "DEVICE";
  const branch = locations.find((l) => l.id === locationId);
  const [captureTouched, setCaptureTouched] = useState(false);
  function onLocationChange(id: string) {
    const l = locations.find((x) => x.id === id);
    if (l && !captureTouched) setCapture(l.hasBiometricDevice ? "DEVICE" : "MANUAL");
  }
  function setCapture(c: "DEVICE" | "MANUAL") {
    form.setFieldValue(["official", "attendanceCapture"], c);
    if (c === "MANUAL") {
      form.setFieldValue(["official", "deviceUserId"], undefined);
      setDeviceCheck(null);
    }
  }

  const OFFICIAL_FIELDS = ["locationId", "attendanceCapture", "deviceUserId", "employeeCode", "dateOfJoining", "departmentId", "designationId", "locationId", "employmentType"];
  const PERSONAL_FIELDS = [
    "fullName",
    "dateOfBirth",
    "gender",
    "personalEmail",
    "mobile",
    "currentAddress",
    "permanentAddress",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
  ];
  const stepFields: Record<number, string[][]> = {
    0: OFFICIAL_FIELDS.map((f) => ["official", f]),
    1: PERSONAL_FIELDS.map((f) => ["personal", f]),
    2: [],
    3: [["bank", "accountNumberConfirm"]],
  };

  async function next() {
    const fields = stepFields[current];
    if (fields && fields.length > 0) {
      try {
        await form.validateFields(fields as never);
      } catch {
        return;
      }
    }
    setCurrent((c) => c + 1);
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const values = form.getFieldsValue(true);
      const official = { ...values.official, dateOfJoining: values.official.dateOfJoining.format("YYYY-MM-DD") };
      const personal = { ...values.personal, dateOfBirth: values.personal.dateOfBirth.format("YYYY-MM-DD") };
      const statutory = values.statutory && Object.values(values.statutory).some(Boolean) ? values.statutory : undefined;
      const bank = values.bank?.accountNumber ? values.bank : undefined;

      const result = await employeeApi.createEmployee({ official, personal, statutory, bank });
      setCreated(result);
    } catch (err) {
      setSubmitError(errorMessage(err, "Could not create employee."));
    } finally {
      setSubmitting(false);
    }
  }

  const values = form.getFieldsValue(true) as {
    official?: Record<string, unknown>;
    personal?: Record<string, unknown>;
    statutory?: Record<string, unknown>;
    bank?: Record<string, unknown>;
  };

  if (created) {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%", maxWidth: 720 }} data-testid="employee-created">
        <Title level={3} style={{ margin: 0 }}>
          Employee {created.employeeCode} created
        </Title>
        <InvitationStatus employeeId={created.id} invitation={created.invitation} />
        <Space wrap>
          <Button type="primary" onClick={() => navigate(`/admin/employee/profile/${created.id}`)}>
            Open profile
          </Button>
          <Button
            onClick={() => {
              form.resetFields();
              setCurrent(0);
              setCreated(null);
              setDeviceCheck(null);
            }}
          >
            Add another employee
          </Button>
        </Space>
      </Space>
    );
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Add Employee
      </Title>
      <Steps current={current} items={STEPS.map((s) => ({ title: s }))} />

      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ official: { employmentType: "PERMANENT", attendanceCapture: "DEVICE" } }}>
        <div style={{ display: current === 0 ? "block" : "none" }}>
          <Form.Item name={["official", "locationId"]} label="Branch" rules={[{ required: true }]}>
            <Select
              options={locations.map((l) => ({ value: l.id, label: l.hasBiometricDevice ? l.name : `${l.name} (no biometric machine)` }))}
              showSearch
              optionFilterProp="label"
              onChange={onLocationChange}
            />
          </Form.Item>
          <Form.Item name={["official", "attendanceCapture"]} label="Attendance capture" rules={[{ required: true }]}>
            <Radio.Group
              onChange={(e) => {
                setCaptureTouched(true);
                setCapture(e.target.value as "DEVICE" | "MANUAL");
              }}
            >
              <Space orientation="vertical">
                <Radio value="DEVICE">Biometric device — enter their Device User ID</Radio>
                <Radio value="MANUAL">No device: attendance is marked manually</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
          {capture === "MANUAL" && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              title="This person's attendance will be marked manually by whoever marks their branch."
              description="They won't punch a biometric machine, so no Device User ID is needed. Their days show as Not marked until someone enters them — never as absent. If they move to a branch with a machine later, add a Device User ID then."
            />
          )}
          {capture === "MANUAL" && branch?.hasBiometricDevice && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={`${branch.name} has a biometric machine. Choose manual only if this person really won't punch it.`} />
          )}
          {capture === "DEVICE" && branch && !branch.hasBiometricDevice && (
            <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={`${branch.name} has no biometric machine. Their punches will only arrive if they use a machine at another branch.`} />
          )}
          {capture === "DEVICE" && (
            <Form.Item name={["official", "deviceUserId"]} label="Device User ID" rules={[{ required: true, message: "Enter the ID from the biometric machine — or choose \"No device: attendance is marked manually\"" }]} extra="The raw ID assigned on the biometric machine.">
              <Input onChange={(e) => void onDeviceUserIdChange(e.target.value)} placeholder="e.g. 1042" />
            </Form.Item>
          )}
          {checkingDevice && <Text type="secondary">Checking…</Text>}
          {deviceCheck?.collision && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title={`Employee Code ${deviceCheck.collision.employeeCode} was already used by ${deviceCheck.collision.fullName}${deviceCheck.collision.separatedOn ? `, separated on ${deviceCheck.collision.separatedOn}` : ""}. Employee Codes are never reused.`}
              description={`Suggested code: ${deviceCheck.suggestedEmployeeCode} (pre-filled below — you can still type a different one).`}
            />
          )}
          <Form.Item
            name={["official", "employeeCode"]}
            label="Employee Code"
            rules={[{ required: true }]}
            extra={capture === "DEVICE" ? "Permanent login username — pre-filled from Device User ID, editable." : "Permanent login username."}
          >
            <Input />
          </Form.Item>
          <Form.Item name={["official", "dateOfJoining"]} label="Date of Joining" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={["official", "departmentId"]} label="Department" rules={[{ required: true }]}>
            <Select options={departments.map((d) => ({ value: d.id, label: d.name }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name={["official", "designationId"]} label="Designation" rules={[{ required: true }]}>
            <Select options={designations.map((d) => ({ value: d.id, label: d.name }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name={["official", "gradeId"]} label="Grade">
            <Select allowClear options={grades.map((g) => ({ value: g.id, label: g.name }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name={["official", "costCentreId"]} label="Cost Centre">
            <Select allowClear options={costCentres.map((c) => ({ value: c.id, label: c.name }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name={["official", "reportingManagerId"]} label="Reporting Manager">
            <Select allowClear placeholder="None — they'll show as Unassigned" options={managerOptions.map((m) => ({ value: m.employeeId, label: `${m.name} (${m.employeeCode})` }))} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item name={["official", "employmentType"]} label="Employment Type" rules={[{ required: true }]}>
            <Select options={["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"].map((t) => ({ value: t, label: t }))} />
          </Form.Item>
          <Form.Item name={["official", "officialEmail"]} label="Official Email">
            <Input />
          </Form.Item>
        </div>

        <div style={{ display: current === 1 ? "block" : "none" }}>
          <Form.Item name={["personal", "fullName"]} label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name={["personal", "dateOfBirth"]} label="Date of Birth" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={["personal", "gender"]} label="Gender" rules={[{ required: true }]}>
            <Select options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }, { value: "OTHER", label: "Other" }]} />
          </Form.Item>
          <Form.Item name={["personal", "personalEmail"]} label="Personal Email (Gmail)" rules={[{ required: true, type: "email" }]}>
            <Input />
          </Form.Item>
          <Form.Item name={["personal", "mobile"]} label="Mobile" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name={["personal", "currentAddress"]} label="Current Address" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name={["personal", "permanentAddress"]} label="Permanent Address" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name={["personal", "emergencyContactName"]} label="Emergency Contact Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name={["personal", "emergencyContactPhone"]} label="Emergency Contact Phone" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name={["personal", "emergencyContactRelation"]} label="Relation" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name={["personal", "bloodGroup"]} label="Blood Group">
            <Input />
          </Form.Item>
        </div>

        <div style={{ display: current === 2 ? "block" : "none" }}>
          <Text type="secondary">Optional at this stage — can be added later.</Text>
          <Form.Item name={["statutory", "pan"]} label="PAN">
            <Input />
          </Form.Item>
          <Form.Item name={["statutory", "aadhaar"]} label="Aadhaar">
            <Input />
          </Form.Item>
          <Form.Item name={["statutory", "uan"]} label="UAN / PF Number">
            <Input />
          </Form.Item>
          <Form.Item name={["statutory", "esiNumber"]} label="ESI Number">
            <Input />
          </Form.Item>
        </div>

        <div style={{ display: current === 3 ? "block" : "none" }}>
          <Text type="secondary">Optional at this stage — can be added later.</Text>
          <Form.Item name={["bank", "accountHolderName"]} label="Account Holder Name">
            <Input />
          </Form.Item>
          <Form.Item name={["bank", "accountNumber"]} label="Account Number">
            <Input />
          </Form.Item>
          <Form.Item
            name={["bank", "accountNumberConfirm"]}
            label="Confirm Account Number"
            dependencies={[["bank", "accountNumber"]]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || value === getFieldValue(["bank", "accountNumber"])) return Promise.resolve();
                  return Promise.reject(new Error("Account numbers don't match."));
                },
              }),
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item name={["bank", "ifsc"]} label="IFSC">
            <Input />
          </Form.Item>
          <Form.Item name={["bank", "bankName"]} label="Bank Name">
            <Input />
          </Form.Item>
          <Form.Item name={["bank", "branchName"]} label="Branch Name">
            <Input />
          </Form.Item>
        </div>

        {current === 4 && (
          <Space orientation="vertical" style={{ width: "100%" }}>
            {submitError && <Alert type="error" showIcon title={submitError} />}
            <Typography.Paragraph>
              <strong>{String(values.personal?.fullName ?? "")}</strong> ({String(values.official?.employeeCode ?? "")}) — review the
              details in previous steps, then save and send the set-password invitation.
            </Typography.Paragraph>
            <Typography.Paragraph>
              Attendance:{" "}
              {values.official?.attendanceCapture === "MANUAL" ? (
                <strong>marked manually (no biometric device)</strong>
              ) : (
                <strong>biometric device, Device User ID {String(values.official?.deviceUserId ?? "")}</strong>
              )}
              . They get the company's default shift and week-off from their first day; change it in Attendance Settings → Assignments.
            </Typography.Paragraph>
          </Space>
        )}
      </Form>

      <Space>
        {current > 0 && <Button onClick={() => setCurrent((c) => c - 1)}>Back</Button>}
        {current < STEPS.length - 1 && (
          <Button type="primary" onClick={() => void next()}>
            Next
          </Button>
        )}
        {current === STEPS.length - 1 && (
          <Button type="primary" loading={submitting} onClick={() => void submit()}>
            Save &amp; Send Invite
          </Button>
        )}
      </Space>
    </Space>
  );
}
