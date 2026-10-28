import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input } from "antd";
import { SendOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as employeeApi from "../../../api/employee";
import { PhotoUploader } from "../../../components/common/PhotoUploader";
import * as peopleApi from "../../../api/people";
import { EmptyState, InitialsAvatar, PageHeader, QueryState, SideDrawer, Skel, SkeletonCard, StatusChip, toast } from "../../../ui";
import { fs, space, v } from "../../../theme/tokens";
// The same profile layout as the admin employee profile (employees-05..11): card on the left, tabbed sections on the right.
import { Grid, ProfileCard, ProfileSection, ProfileShell, ProfileTabs, SectionStack } from "../../admin/employee/ProfileLayout";
import { personalSections, statutoryItems } from "../../admin/employee/profileItems";

type ChangeRequestFieldGroup = "bank" | "statutory" | "personal";

const REQUEST_TITLE: Record<ChangeRequestFieldGroup, string> = {
  personal: "Request a change to personal details",
  statutory: "Request a change to statutory details",
  bank: "Request a change to bank details",
};
const REQUEST_FORM_ID = "my-info-change-request";
const SELF_SERVICE_FORM_ID = "my-info-self-service";

function RequestChangeDrawer({ open, fieldGroup, onClose }: { open: boolean; fieldGroup: ChangeRequestFieldGroup | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const mutation = useMutation({
    mutationFn: (changes: Record<string, unknown>) => employeeApi.createChangeRequest({ fieldGroup: fieldGroup!, changes } as employeeApi.CreateChangeRequestInput),
    onSuccess: () => {
      close();
      toast.success("Change request submitted — HR will review it.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not submit request.")),
  });
  // The drawer's form instance outlives the drawer, so clear it on close: a reopened drawer (or another field group) starts empty instead of resubmitting the last request.
  const close = () => {
    form.resetFields();
    onClose();
  };
  const submit = (vals: Record<string, unknown>) => {
    const changes = Object.fromEntries(Object.entries(vals).filter(([, value]) => typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null));
    if (Object.keys(changes).length === 0) {
      toast.warning("Enter at least one change to request.");
      return;
    }
    mutation.mutate(changes);
  };

  return (
    <SideDrawer
      open={open}
      onClose={close}
      title={fieldGroup ? REQUEST_TITLE[fieldGroup] : "Request a change"}
      subtitle="HR reviews every request. Nothing changes on your profile until they approve it."
      formId={REQUEST_FORM_ID}
      primaryLabel="Submit for HR approval"
      primaryLoading={mutation.isPending}
    >
      <Form id={REQUEST_FORM_ID} form={form} layout="vertical" onFinish={submit} requiredMark={false}>
        {fieldGroup === "personal" && (
          <>
            <Form.Item name="mobile" label="New mobile number"><Input inputMode="tel" autoComplete="tel" /></Form.Item>
            <Form.Item name="personalEmail" label="New personal email (Gmail)"><Input type="email" autoComplete="email" /></Form.Item>
            <Form.Item name="bloodGroup" label="Blood group"><Input /></Form.Item>
          </>
        )}
        {fieldGroup === "statutory" && (
          <>
            <Form.Item name="pan" label="PAN"><Input autoComplete="off" /></Form.Item>
            <Form.Item name="aadhaar" label="Aadhaar"><Input autoComplete="off" inputMode="numeric" /></Form.Item>
            <Form.Item name="uan" label="UAN"><Input autoComplete="off" inputMode="numeric" /></Form.Item>
            <Form.Item name="esiNumber" label="ESI Number"><Input autoComplete="off" /></Form.Item>
          </>
        )}
        {fieldGroup === "bank" && (
          <>
            <Form.Item name="accountHolderName" label="Account Holder Name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="accountNumber" label="New Account Number" rules={[{ required: true }]}><Input autoComplete="off" inputMode="numeric" /></Form.Item>
            <Form.Item
              name="accountNumberConfirm"
              label="Confirm Account Number"
              dependencies={["accountNumber"]}
              rules={[{ required: true }, ({ getFieldValue }) => ({ validator(_, value) { return value === getFieldValue("accountNumber") ? Promise.resolve() : Promise.reject(new Error("Doesn't match.")); } })]}
            >
              <Input autoComplete="off" inputMode="numeric" />
            </Form.Item>
            <Form.Item name="ifsc" label="IFSC" rules={[{ required: true }]}><Input autoComplete="off" /></Form.Item>
            <Form.Item name="bankName" label="Bank Name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="branchName" label="Branch Name" rules={[{ required: true }]}><Input /></Form.Item>
          </>
        )}
      </Form>
    </SideDrawer>
  );
}

function EditSelfServiceDrawer({ open, profile, onClose }: { open: boolean; profile: employeeApi.EmployeeProfile; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const mutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => employeeApi.updateSelfService(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "me"] });
      onClose();
      toast.success("Updated.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not update.")),
  });

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Edit address & emergency contact"
      subtitle="These change straight away — no HR approval needed."
      formId={SELF_SERVICE_FORM_ID}
      primaryLabel="Save"
      primaryLoading={mutation.isPending}
    >
      <Form id={SELF_SERVICE_FORM_ID} form={form} layout="vertical" onFinish={(vals) => mutation.mutate(vals)} requiredMark={false} initialValues={profile.personal ?? {}}>
        <Form.Item name="currentAddress" label="Current Address"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="permanentAddress" label="Permanent Address"><Input.TextArea rows={2} /></Form.Item>
        <Form.Item name="emergencyContactName" label="Emergency Contact Name"><Input /></Form.Item>
        <Form.Item name="emergencyContactPhone" label="Emergency Contact Phone"><Input inputMode="tel" /></Form.Item>
        <Form.Item name="emergencyContactRelation" label="Relation"><Input /></Form.Item>
      </Form>
    </SideDrawer>
  );
}

function MyInfoSkeleton() {
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

function MaskedNote() {
  return <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: space[4] }}>Shown masked (last 4 digits) for your security.</div>;
}

export function ViewMyInfoPage() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading, error, refetch } = useQuery({ queryKey: ["employees", "me"], queryFn: employeeApi.getMyProfile });
  const [editOpen, setEditOpen] = useState(false);
  const [requestGroup, setRequestGroup] = useState<ChangeRequestFieldGroup | null>(null);

  const header = <PageHeader title="My Info" subtitle="Your official, personal, statutory and bank details" />;
  if (isLoading || error || !profile) {
    return (
      <>
        {header}
        <QueryState isLoading={isLoading || (!error && !profile)} error={error} onRetry={() => void refetch()} skeleton={<MyInfoSkeleton />}>
          {null}
        </QueryState>
      </>
    );
  }

  const requestButton = (group: ChangeRequestFieldGroup, label = "Request a change") => (
    <Button icon={<SendOutlined />} onClick={() => setRequestGroup(group)}>
      {label}
    </Button>
  );

  const personal = profile.personal ? personalSections(profile.personal) : null;

  return (
    <>
      {header}
      <ProfileShell
        card={
          <ProfileCard
            profile={profile}
            avatar={
              profile.personal ? (
                <PhotoUploader
                  stacked
                  size={84}
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
              ) : (
                <InitialsAvatar name={profile.fullName} size={84} />
              )
            }
          />
        }
      >
        <ProfileTabs
          items={[
            {
              key: "official",
              label: "Official",
              children: (
                <SectionStack>
                  <ProfileSection title="Employment information">
                    <Grid
                      items={[
                        { label: "Employee Code", value: profile.employeeCode },
                        { label: "Status", value: <StatusChip status={profile.status} /> },
                        { label: "Date of Joining", value: profile.dateOfJoining },
                      ]}
                    />
                  </ProfileSection>
                  <ProfileSection title="Job">
                    <Grid
                      items={[
                        { label: "Department", value: profile.job?.department.name ?? "—" },
                        { label: "Designation", value: profile.job?.designation.name ?? "—" },
                        { label: "Location", value: profile.job?.location.name ?? "—" },
                        { label: "Reporting Manager", value: profile.job?.reportingManager?.fullName ?? "—" },
                      ]}
                    />
                  </ProfileSection>
                </SectionStack>
              ),
            },
            {
              key: "personal",
              label: "Personal",
              children:
                profile.personal && personal ? (
                  <SectionStack>
                    <ProfileSection title="Personal info" extra={requestButton("personal", "Request other changes")}>
                      <Grid items={personal.info} />
                    </ProfileSection>
                    <ProfileSection title="Address" onEdit={() => setEditOpen(true)} editLabel="Edit address / emergency contact">
                      <Grid items={personal.address} />
                    </ProfileSection>
                    <ProfileSection title="Emergency contact" onEdit={() => setEditOpen(true)} editLabel="Edit address / emergency contact">
                      <Grid items={personal.emergency} />
                    </ProfileSection>
                  </SectionStack>
                ) : (
                  <EmptyState compact title="No personal details on file." description="Ask HR to add them." />
                ),
            },
            {
              key: "statutory",
              label: "Statutory",
              children: profile.statutory ? (
                <SectionStack>
                  <ProfileSection title="Statutory details" extra={requestButton("statutory")}>
                    {/* Masked (last 4) exactly as before; there is no reveal on My Info. */}
                    <Grid items={statutoryItems(profile.statutory)} />
                    <MaskedNote />
                  </ProfileSection>
                </SectionStack>
              ) : (
                <EmptyState compact title="No statutory details on file." description="Ask HR to add your PAN, Aadhaar, UAN or ESI number." />
              ),
            },
            {
              key: "bank",
              label: "Bank",
              children: profile.bank ? (
                <SectionStack>
                  <ProfileSection title="Salary account" extra={requestButton("bank")}>
                    <Grid
                      items={[
                        { label: "Account Holder", value: profile.bank.accountHolderName },
                        { label: "Account Number", value: `••••${profile.bank.accountNumberLast4}` },
                        { label: "IFSC", value: profile.bank.ifsc },
                        { label: "Bank", value: profile.bank.bankName },
                      ]}
                    />
                    <MaskedNote />
                  </ProfileSection>
                </SectionStack>
              ) : (
                <EmptyState compact title="No bank account on file." description="Ask HR to add the account your salary should be paid into." />
              ),
            },
          ]}
        />
      </ProfileShell>

      <EditSelfServiceDrawer open={editOpen} profile={profile} onClose={() => setEditOpen(false)} />
      <RequestChangeDrawer open={requestGroup !== null} fieldGroup={requestGroup} onClose={() => setRequestGroup(null)} />
    </>
  );
}
