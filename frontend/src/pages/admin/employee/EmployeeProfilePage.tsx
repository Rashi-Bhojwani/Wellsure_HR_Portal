import { RevealButton } from "../../../components/common/RevealButton";
import { EffectiveDateHint, HistoryStatusCell, type HistoryStatus } from "../../../lib/effectiveDate";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Form, Input, Popconfirm, Select, type MenuProps } from "antd";
import { EditOutlined, ExportOutlined as SeparateIcon } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import dayjs from "dayjs";
import * as employeeApi from "../../../api/employee";
import * as orgApi from "../../../api/org";
import * as managersApi from "../../../api/managers";
import { useAuth } from "../../../hooks/useAuth";
import { InvitationStatus } from "../../../components/common/InvitationStatus";
// PEEPS-BEGIN avatars
import { ProfilePhoto } from "../../../features/avatars/ProfilePhoto";
// PEEPS-END
import { EmployeeDocumentsTab } from "./EmployeeDocumentsTab";
import { EmployeeAccessTab } from "../../../components/access/EmployeeAccessTab";
import { EmptyState, PageHeader, QueryState, SideDrawer, Skel, SkeletonCard, StatusChip, Timeline, toast, type TimelineItem } from "../../../ui";
import { fs, space, v } from "../../../theme/tokens";
import { Grid, ProfileCard, ProfileSection, ProfileShell, ProfileTabs, SectionStack } from "./ProfileLayout";
import { personalSections, statutoryItems } from "./profileItems";

const REFERENCE_STALE = 30_000;

function OfficialTab({ profile, onEditJob }: { profile: employeeApi.EmployeeProfile; onEditJob?: () => void }) {
  return (
    <SectionStack>
      <ProfileSection title="Employment information">
        <Grid
          items={[
            { label: "Employee Code", value: profile.employeeCode },
            { label: "Status", value: <StatusChip status={profile.status} /> },
            { label: "Date of Joining", value: profile.dateOfJoining },
            { label: "Last Working Date", value: profile.lastWorkingDate ?? "—" },
            { label: "Employment Type", value: profile.employmentType },
            { label: "Official Email", value: profile.officialEmail ?? "—" },
          ]}
        />
      </ProfileSection>
      <ProfileSection title="Job" onEdit={onEditJob} editLabel="Change job details">
        <Grid
          items={[
            { label: "Department", value: profile.job?.department.name ?? "—" },
            { label: "Designation", value: profile.job?.designation.name ?? "—" },
            { label: "Location", value: profile.job?.location.name ?? "—" },
            { label: "Grade", value: profile.job?.grade?.name ?? "—" },
            { label: "Cost Centre", value: profile.job?.costCentre?.name ?? "—" },
            { label: "Reporting Manager", value: profile.job?.reportingManager?.fullName ?? "—" },
          ]}
        />
      </ProfileSection>
      <ProfileSection title="Account and attendance">
        <Grid
          items={[
            { label: "Account Status", value: profile.accountStatus ?? "—" },
            { label: "2FA", value: profile.totpEnabled ? "Enabled" : "Not enabled" },
            {
              label: "Attendance capture",
              value: profile.attendanceCapture === "MANUAL" ? <StatusChip tone="purple">Manual attendance — marked by whoever marks their branch</StatusChip> : "Biometric device",
              wide: profile.attendanceCapture === "MANUAL",
            },
          ]}
        />
        {profile.invitation && (
          <div style={{ marginTop: space[5] }}>
            <div style={{ color: v.textSecondary, fontSize: fs.md, marginBottom: space[2] }}>Invitation email</div>
            <InvitationStatus employeeId={profile.id} invitation={profile.invitation} />
          </div>
        )}
      </ProfileSection>
    </SectionStack>
  );
}

function PersonalTab({ profile }: { profile: employeeApi.EmployeeProfile }) {
  if (!profile.personal) return <EmptyState compact title="No personal details on file." description={null} />;
  const s = personalSections(profile.personal);
  return (
    <SectionStack>
      <ProfileSection title="Personal info">
        <Grid items={[{ label: "Full Name", value: profile.fullName }, ...s.info]} />
      </ProfileSection>
      <ProfileSection title="Address">
        <Grid items={s.address} />
      </ProfileSection>
      <ProfileSection title="Emergency contact">
        <Grid items={s.emergency} />
      </ProfileSection>
    </SectionStack>
  );
}

function StatutoryTab({ employeeId, profile, canEdit }: { employeeId: string; profile: employeeApi.EmployeeProfile; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<Awaited<ReturnType<typeof employeeApi.revealStatutory>> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form] = Form.useForm();

  const revealMutation = useMutation({
    mutationFn: (reason: string) => employeeApi.revealStatutory(employeeId, reason),
    onSuccess: setRevealed,
    onError: (err) => toast.error(errorMessage(err, "Could not reveal statutory details.")),
  });
  const saveMutation = useMutation({
    mutationFn: (values: { pan?: string; aadhaar?: string; uan?: string; esiNumber?: string }) => employeeApi.updateStatutory(employeeId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      setEditOpen(false);
      toast.success("Statutory details updated.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not update.")),
  });

  if (profile.statutory === undefined) return <EmptyState kind="forbidden" compact title="You don't have permission to view statutory details." description={null} />;
  if (profile.statutory === null) return <EmptyState compact title="No statutory details on file." description={null} />;

  return (
    <SectionStack>
      <ProfileSection
        title="Statutory details"
        onEdit={
          canEdit
            ? () => {
                form.resetFields();
                setEditOpen(true);
              }
            : undefined
        }
        editLabel="Edit statutory details"
        extra={
          <RevealButton label="Reveal full details" loading={revealMutation.isPending} onReveal={(reason) => revealMutation.mutate(reason)} />
        }
      >
        <Grid items={statutoryItems(profile.statutory, revealed)} />
      </ProfileSection>
      <SideDrawer title="Edit statutory details" open={editOpen} onClose={() => setEditOpen(false)} formId="statutory-edit-form" primaryLabel="Save" primaryLoading={saveMutation.isPending}>
        <Form id="statutory-edit-form" form={form} layout="vertical" onFinish={(val) => saveMutation.mutate(val)} requiredMark={false}>
          <Form.Item name="pan" label="PAN"><Input /></Form.Item>
          <Form.Item name="aadhaar" label="Aadhaar"><Input /></Form.Item>
          <Form.Item name="uan" label="UAN"><Input /></Form.Item>
          <Form.Item name="esiNumber" label="ESI Number"><Input /></Form.Item>
        </Form>
      </SideDrawer>
    </SectionStack>
  );
}

function BankTab({ employeeId, profile, canEdit }: { employeeId: string; profile: employeeApi.EmployeeProfile; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = useState<Awaited<ReturnType<typeof employeeApi.revealBank>> | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form] = Form.useForm();

  const revealMutation = useMutation({
    mutationFn: (reason: string) => employeeApi.revealBank(employeeId, reason),
    onSuccess: setRevealed,
    onError: (err) => toast.error(errorMessage(err, "Could not reveal bank details.")),
  });
  const saveMutation = useMutation({
    mutationFn: (values: { accountHolderName: string; accountNumber: string; accountNumberConfirm: string; ifsc: string; bankName: string; branchName: string }) =>
      employeeApi.updateBank(employeeId, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      setEditOpen(false);
      toast.success("Bank details updated — the previous account is closed as of today, this one is now active.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not update.")),
  });

  if (profile.bank === undefined) return <EmptyState kind="forbidden" compact title="You don't have permission to view bank details." description={null} />;
  if (profile.bank === null) return <EmptyState compact title="No bank account on file." description={null} />;

  return (
    <SectionStack>
      <ProfileSection
        title="Bank account"
        extra={
          <>
            <RevealButton label="Reveal full account number" loading={revealMutation.isPending} onReveal={(reason) => revealMutation.mutate(reason)} />
            {canEdit && (
              <Button
                icon={<EditOutlined />}
                onClick={() => {
                  form.resetFields();
                  setEditOpen(true);
                }}
              >
                Change bank account
              </Button>
            )}
          </>
        }
      >
        <Grid
          items={[
            { label: "Account Holder", value: profile.bank.accountHolderName },
            { label: "Account Number", value: revealed?.accountNumber ?? `••••${profile.bank.accountNumberLast4}` },
            { label: "IFSC", value: profile.bank.ifsc },
            { label: "Bank", value: profile.bank.bankName },
            { label: "Branch", value: profile.bank.branchName },
            { label: "Effective From", value: profile.bank.effectiveFrom },
          ]}
        />
      </ProfileSection>
      <SideDrawer title="Change bank account" open={editOpen} onClose={() => setEditOpen(false)} formId="bank-edit-form" primaryLabel="Save" primaryLoading={saveMutation.isPending}>
        <Alert type="info" showIcon style={{ marginBottom: space[4] }} title="This closes the current account (effective today) and opens the new one." />
        <Form id="bank-edit-form" form={form} layout="vertical" onFinish={(val) => saveMutation.mutate(val)} requiredMark={false}>
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
        </Form>
      </SideDrawer>
    </SectionStack>
  );
}

function JobEditDrawer({ employeeId, open, onClose }: { employeeId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const effectiveFrom = Form.useWatch("effectiveFrom", form) as dayjs.Dayjs | undefined;
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, staleTime: REFERENCE_STALE });
  const { data: designations = [] } = useQuery({ queryKey: ["org", "designations"], queryFn: orgApi.designations.list, staleTime: REFERENCE_STALE });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(false), staleTime: REFERENCE_STALE });
  // Only once the drawer opens: a viewer who can see the profile but not edit it (a manager) would get a 403.
  const { data: managers = [] } = useQuery({ queryKey: ["managers", "options"], queryFn: managersApi.managerOptions, enabled: open });

  const mutation = useMutation({
    mutationFn: (values: { departmentId?: string; designationId?: string; locationId?: string; reportingManagerId?: string; effectiveFrom: dayjs.Dayjs; changeReason?: string }) =>
      employeeApi.updateJob(employeeId, { ...values, effectiveFrom: values.effectiveFrom.format("YYYY-MM-DD") }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      void queryClient.invalidateQueries({ queryKey: ["employees", "history", employeeId, "job"] });
      void queryClient.invalidateQueries({ queryKey: ["managers"] });
      onClose();
      toast.success("Job details updated.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not update job details.")),
  });

  return (
    <SideDrawer title="Change job details" open={open} onClose={onClose} formId="job-edit-form" primaryLabel="Save" primaryLoading={mutation.isPending}>
      <Form id="job-edit-form" form={form} layout="vertical" onFinish={(val) => mutation.mutate(val)} requiredMark={false} initialValues={{ effectiveFrom: dayjs() }}>
        <Form.Item name="departmentId" label="Department"><Select allowClear options={departments.map((d) => ({ value: d.id, label: d.name }))} /></Form.Item>
        <Form.Item name="designationId" label="Designation"><Select allowClear options={designations.map((d) => ({ value: d.id, label: d.name }))} /></Form.Item>
        <Form.Item name="locationId" label="Location"><Select allowClear options={locations.map((l) => ({ value: l.id, label: l.name }))} /></Form.Item>
        <Form.Item name="reportingManagerId" label="Reporting manager" extra="Only managers. To move someone between teams, Manager Management is quicker.">
          <Select allowClear placeholder="Leave unchanged" options={managers.filter((m) => m.employeeId !== employeeId).map((m) => ({ value: m.employeeId, label: `${m.name} (${m.employeeCode})` }))} showSearch optionFilterProp="label" />
        </Form.Item>
        <Form.Item name="effectiveFrom" label="Effective From" rules={[{ required: true }]} extra={<EffectiveDateHint value={effectiveFrom} />}><DatePicker style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="changeReason" label="Reason"><Input placeholder="e.g. Promotion, Transfer" /></Form.Item>
      </Form>
    </SideDrawer>
  );
}

const TONE: Record<HistoryStatus, TimelineItem["tone"]> = { current: "accent", scheduled: "warning", past: "neutral" };

function HistoryTab({ employeeId, canViewBank }: { employeeId: string; canViewBank: boolean }) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const job = useQuery({ queryKey: ["employees", "history", employeeId, "job"], queryFn: () => employeeApi.getJobHistory(employeeId) });
  const name = useQuery({ queryKey: ["employees", "history", employeeId, "name"], queryFn: () => employeeApi.getNameHistory(employeeId) });
  const bank = useQuery({ queryKey: ["employees", "history", employeeId, "bank"], queryFn: () => employeeApi.getBankHistory(employeeId), enabled: canViewBank });
  // EF3: a scheduled change can be cancelled until its day (the previous row reopens).
  const cancel = useMutation({
    mutationFn: ({ kind, rowId }: { kind: "job" | "name" | "bank"; rowId: string }) => employeeApi.cancelScheduledChange(employeeId, kind, rowId),
    onSuccess: () => {
      toast.success("Scheduled change cancelled.");
      void queryClient.invalidateQueries({ queryKey: ["employees", "history", employeeId] });
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
    },
    onError: (err) => toast.error(errorMessage(err, "Couldn't cancel it.")),
  });
  const canCancel = { job: hasPermission("employee.edit") || hasPermission("manager.team.assign"), name: hasPermission("employee.edit"), bank: hasPermission("employee.bank.edit") };

  // Effective-dated rows as a timeline (recruitment-08 / employees-07): what changed, from when, until when, why.
  const when = (kind: "job" | "name" | "bank", r: { id: string; status: HistoryStatus; effectiveFrom: string; effectiveTo: string | null }) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
      From {r.effectiveFrom} · <HistoryStatusCell status={r.status} effectiveFrom={r.effectiveFrom} effectiveTo={r.effectiveTo} />
      {r.status === "scheduled" && canCancel[kind] && (
        <Popconfirm title="Cancel this scheduled change? The current record stays as it is." okText="Cancel change" cancelText="Keep it" onConfirm={() => cancel.mutate({ kind, rowId: r.id })}>
          <Button size="small" danger type="link">
            Cancel
          </Button>
        </Popconfirm>
      )}
    </span>
  );
  const empty = <EmptyState compact title="No history yet." description={null} />;
  const caption = (parts: (string | null)[]) => <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{parts.filter(Boolean).join(" · ")}</span>;

  return (
    <SectionStack>
      <ProfileSection title="Job history">
        <QueryState isLoading={job.isLoading} error={job.error} onRetry={() => void job.refetch()} skeleton={<SkeletonCard lines={3} />}>
          <Timeline
            empty={empty}
            items={(job.data ?? []).map((r) => ({
              key: r.id,
              tone: TONE[r.status],
              content: (
                <>
                  <strong>{r.designation}</strong> · {r.department} · {r.location}
                </>
              ),
              time: when("job", r),
              detail: caption([r.reportingManager ? `Manager: ${r.reportingManager}` : "Manager: —", r.changeReason ? `Reason: ${r.changeReason}` : null]),
            }))}
          />
        </QueryState>
      </ProfileSection>
      <ProfileSection title="Name history">
        <QueryState isLoading={name.isLoading} error={name.error} onRetry={() => void name.refetch()} skeleton={<SkeletonCard lines={2} />}>
          <Timeline
            empty={empty}
            items={(name.data ?? []).map((r) => ({
              key: r.id,
              tone: TONE[r.status],
              content: <strong>{r.fullName}</strong>,
              time: when("name", r),
              detail: r.changeReason ? caption([`Reason: ${r.changeReason}`]) : undefined,
            }))}
          />
        </QueryState>
      </ProfileSection>
      {canViewBank && (
        <ProfileSection title="Bank history">
          <QueryState isLoading={bank.isLoading} error={bank.error} onRetry={() => void bank.refetch()} skeleton={<SkeletonCard lines={2} />}>
            <Timeline
              empty={empty}
              items={(bank.data ?? []).map((r) => ({
                key: r.id,
                tone: TONE[r.status],
                content: (
                  <>
                    <strong>{r.bankName}</strong> · account ending {r.accountNumberLast4}
                  </>
                ),
                time: when("bank", r),
                detail: caption([`IFSC ${r.ifsc}`]),
              }))}
            />
          </QueryState>
        </ProfileSection>
      )}
    </SectionStack>
  );
}

function SeparationDrawer({ employeeId, open, onClose }: { employeeId: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const mutation = useMutation({
    mutationFn: (values: { lastWorkingDate: dayjs.Dayjs; reason: string; notes?: string }) =>
      employeeApi.initiateSeparation(employeeId, { ...values, lastWorkingDate: values.lastWorkingDate.format("YYYY-MM-DD") }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "profile", employeeId] });
      onClose();
      toast.success("Separation initiated. Login will be disabled automatically the day after the last working date.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not initiate separation.")),
  });
  return (
    <SideDrawer title="Initiate separation" open={open} onClose={onClose} formId="separation-form" primaryLabel="Initiate" primaryDanger primaryLoading={mutation.isPending}>
      <Form id="separation-form" form={form} layout="vertical" onFinish={(val) => mutation.mutate(val)} requiredMark={false}>
        <Form.Item name="lastWorkingDate" label="Last Working Date" rules={[{ required: true }]}><DatePicker style={{ width: "100%" }} /></Form.Item>
        <Form.Item name="reason" label="Reason" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
      </Form>
    </SideDrawer>
  );
}

function ProfileSkeleton() {
  return (
    <ProfileShell card={<SkeletonCard lines={8} height={520} />}>
      <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
        <Skel h={40} />
        <SkeletonCard lines={5} />
        <SkeletonCard lines={4} />
      </div>
    </ProfileShell>
  );
}

export function EmployeeProfilePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { hasPermission, hasRole } = useAuth();
  const [jobEditOpen, setJobEditOpen] = useState(false);
  const [separationOpen, setSeparationOpen] = useState(false);

  const { data: profile, isLoading, error, refetch } = useQuery({
    queryKey: ["employees", "profile", id],
    queryFn: () => employeeApi.getEmployeeProfile(id!),
    enabled: !!id,
  });

  const header = <PageHeader title="Employee details" back />;
  if (isLoading || error || !profile) {
    return (
      <>
        {header}
        <QueryState isLoading={isLoading || (!error && !profile)} error={error} onRetry={() => void refetch()} skeleton={<ProfileSkeleton />}>
          {null}
        </QueryState>
      </>
    );
  }

  const canEdit = hasPermission("employee.edit");
  const canViewBank = hasPermission("employee.bank.view");
  const canSeparate = hasPermission("employee.separate");

  const actions: MenuProps["items"] = [
    ...(canEdit ? [{ key: "job", icon: <EditOutlined />, label: "Change job details", onClick: () => setJobEditOpen(true) }] : []),
    ...(canSeparate && profile.status === "ACTIVE" ? [{ key: "separate", icon: <SeparateIcon />, danger: true, label: "Initiate Separation", onClick: () => setSeparationOpen(true) }] : []),
  ];

  return (
    <>
      {header}
      <ProfileShell
        card={
          <ProfileCard
            profile={profile}
            actions={actions}
            onOpenManager={(mid) => navigate(`/admin/employee/profile/${mid}`)}
            avatar={
              // PEEPS-BEGIN avatars
              // Only the person adds or changes their photo; HR and the directors may remove someone else's, with a reason (features/avatars).
              <ProfilePhoto
                employeeId={id!}
                name={profile.fullName}
                photoVersion={profile.personal?.photoVersion ?? null}
                onChanged={() => void queryClient.invalidateQueries({ queryKey: ["employees", "profile", id] })}
                disabled={!profile.personal}
              />
              // PEEPS-END
            }
          />
        }
      >
        <ProfileTabs
          items={[
            { key: "official", label: "Official", children: <OfficialTab profile={profile} onEditJob={canEdit ? () => setJobEditOpen(true) : undefined} /> },
            { key: "personal", label: "Personal", children: <PersonalTab profile={profile} /> },
            { key: "statutory", label: "Statutory", children: <StatutoryTab employeeId={id!} profile={profile} canEdit={hasPermission("employee.statutory.edit")} /> },
            { key: "bank", label: "Bank", children: <BankTab employeeId={id!} profile={profile} canEdit={hasPermission("employee.bank.edit")} /> },
            ...(hasPermission("employee.documents.view")
              ? [{ key: "documents", label: "Documents", children: <EmployeeDocumentsTab employeeId={id!} canManage={hasPermission("employee.documents.manage")} /> }]
              : []),
            { key: "history", label: "History", children: <HistoryTab employeeId={id!} canViewBank={canViewBank} /> },
            ...(hasRole("SUPER_ADMIN") || hasPermission("role.view") || hasPermission("user.security.manage")
              ? [{ key: "access", label: "Access", children: <EmployeeAccessTab employeeId={id!} /> }]
              : []),
          ]}
        />
      </ProfileShell>

      <JobEditDrawer employeeId={id!} open={jobEditOpen} onClose={() => setJobEditOpen(false)} />
      <SeparationDrawer employeeId={id!} open={separationOpen} onClose={() => setSeparationOpen(false)} />
    </>
  );
}
