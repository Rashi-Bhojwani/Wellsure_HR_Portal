import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Col, Form, Input, Row, Upload } from "antd";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import * as lettersApi from "../../api/letters";
import type { Letterhead } from "../../api/letters";
import { apiErrorMessage } from "../../lib/apiError";
import { fs, radius, space, v } from "../../theme/tokens";
import { ConfirmModal, Panel, QueryState, Skel, toast } from "../../ui";

function LettersSkeleton() {
  return (
    <Panel>
      <Skel w={160} h={22} />
      <Skel w="70%" h={14} style={{ marginTop: space[3] }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: space[5], marginTop: space[6] }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <Skel w={160} h={14} />
            <Skel h={48} r={radius.md} style={{ marginTop: space[2] }} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

// System Settings → Letters (Phase 5 commit D2): the letterhead and signatory
// printed on every letter. Letters already issued keep the letterhead they
// were issued with — a new logo never changes an old letter.
export function LettersSettingsCard() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<Omit<Letterhead, "hasLogo">>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["letters", "letterhead"], queryFn: lettersApi.getLetterhead });
  const { data: logo } = useQuery({ queryKey: ["letters", "letterhead", "logo", data?.hasLogo], queryFn: lettersApi.getLogo, enabled: Boolean(data?.hasLogo) });

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);
  const logoUrl = useMemo(() => (logo && data?.hasLogo ? URL.createObjectURL(logo) : null), [logo, data?.hasLogo]);
  useEffect(() => () => void (logoUrl && URL.revokeObjectURL(logoUrl)), [logoUrl]);

  const applied = (lh: Letterhead) => {
    queryClient.setQueryData(["letters", "letterhead"], lh);
    void queryClient.invalidateQueries({ queryKey: ["letters", "letterhead", "logo"] });
  };
  const save = useMutation({
    mutationFn: lettersApi.updateLetterhead,
    onSuccess: (lh) => {
      applied(lh);
      toast.success("Letterhead saved.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't save the letterhead.")),
  });
  const upload = useMutation({
    mutationFn: lettersApi.uploadLogo,
    onSuccess: (lh) => {
      applied(lh);
      toast.success("Logo updated.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't upload the logo.")),
  });
  const remove = useMutation({
    mutationFn: lettersApi.removeLogo,
    onSuccess: (lh) => {
      applied(lh);
      setConfirmRemove(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't remove the logo.")),
  });

  return (
    <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<LettersSkeleton />}>
      <Panel title="Letters">
        <div style={{ color: v.textSecondary, fontSize: fs.md, marginBottom: space[5] }}>
          The letterhead and signatory on every letter. Letters can't be issued until all four are filled in. Letters already issued keep the letterhead they were issued with.
        </div>
        <Form form={form} layout="vertical" requiredMark onFinish={(vals) => save.mutate(vals)}>
          <Row gutter={[24, 0]}>
            <Col xs={24} md={12}>
              <Form.Item name="legalName" label="Company legal name" rules={[{ required: true }]}>
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item name="registeredAddress" label="Registered address" rules={[{ required: true }]}>
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={1000} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="signatoryName" label="Signatory name" rules={[{ required: true }]}>
                <Input maxLength={120} />
              </Form.Item>
              <Form.Item name="signatoryDesignation" label="Signatory designation" rules={[{ required: true }]}>
                <Input maxLength={120} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Logo" extra="PNG or JPEG, up to 2 MB.">
            <div style={{ display: "flex", gap: space[3], alignItems: "center", flexWrap: "wrap" }}>
              <div
                style={{
                  width: 176,
                  height: 72,
                  border: `1px dashed ${v.borderControl}`,
                  borderRadius: radius.md,
                  background: v.bgSubtle,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: v.textSecondary,
                  fontSize: fs.sm,
                  padding: space[2],
                }}
              >
                {logoUrl ? <img src={logoUrl} alt="Current letterhead logo" style={{ maxHeight: 48, maxWidth: 160 }} /> : "No logo"}
              </div>
              <Upload accept=".png,.jpg,.jpeg" showUploadList={false} beforeUpload={(f) => (upload.mutate(f), false)}>
                <Button icon={<UploadOutlined />} loading={upload.isPending}>
                  {data?.hasLogo ? "Replace logo" : "Upload logo"}
                </Button>
              </Upload>
              {data?.hasLogo && (
                <Button danger icon={<DeleteOutlined />} onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              )}
            </div>
          </Form.Item>
          <Form.Item style={{ marginTop: space[2], marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" size="large" loading={save.isPending} style={{ minWidth: 140 }}>
              Save letterhead
            </Button>
          </Form.Item>
        </Form>
      </Panel>
      <ConfirmModal
        open={confirmRemove}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        danger
        title="Remove the logo from future letters?"
        description="Letters already issued keep the logo they were issued with."
        confirmLabel="Remove logo"
      />
    </QueryState>
  );
}
