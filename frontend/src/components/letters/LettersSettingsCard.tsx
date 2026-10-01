import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Col, Flex, Form, Input, Popconfirm, Row, Typography, Upload, message } from "antd";
import { DeleteOutlined, UploadOutlined } from "@ant-design/icons";
import * as lettersApi from "../../api/letters";
import type { Letterhead } from "../../api/letters";
import { apiErrorMessage } from "../../lib/apiError";

const { Title, Text } = Typography;

// System Settings → Letters (Phase 5 commit D2): the letterhead and signatory
// printed on every letter. Letters already issued keep the letterhead they
// were issued with — a new logo never changes an old letter.
export function LettersSettingsCard() {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<Omit<Letterhead, "hasLogo">>();
  const { data } = useQuery({ queryKey: ["letters", "letterhead"], queryFn: lettersApi.getLetterhead });
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
      void message.success("Letterhead saved.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't save the letterhead.")),
  });
  const upload = useMutation({
    mutationFn: lettersApi.uploadLogo,
    onSuccess: (lh) => {
      applied(lh);
      void message.success("Logo updated.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't upload the logo.")),
  });
  const remove = useMutation({
    mutationFn: lettersApi.removeLogo,
    onSuccess: applied,
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't remove the logo.")),
  });

  return (
    <Card>
      <Title level={5}>Letters</Title>
      <Text type="secondary">
        The letterhead and signatory on every letter. Letters can't be issued until all four are filled in. Letters already issued keep the letterhead they were issued with.
      </Text>
      <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }} onFinish={(v) => save.mutate(v)}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="legalName" label="Company legal name" rules={[{ required: true }]}>
              <Input maxLength={200} />
            </Form.Item>
            <Form.Item name="registeredAddress" label="Registered address" rules={[{ required: true }]}>
              <Input.TextArea rows={3} maxLength={1000} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="signatoryName" label="Signatory name" rules={[{ required: true }]}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item name="signatoryDesignation" label="Signatory designation" rules={[{ required: true }]}>
              <Input maxLength={120} />
            </Form.Item>
            <Form.Item label="Logo" extra="PNG or JPEG, up to 2 MB.">
              <Flex gap={12} align="center" wrap>
                {logoUrl && <img src={logoUrl} alt="Current letterhead logo" style={{ maxHeight: 48, maxWidth: 160 }} />}
                <Upload accept=".png,.jpg,.jpeg" showUploadList={false} beforeUpload={(f) => (upload.mutate(f), false)}>
                  <Button icon={<UploadOutlined />} loading={upload.isPending}>
                    {data?.hasLogo ? "Replace logo" : "Upload logo"}
                  </Button>
                </Upload>
                {data?.hasLogo && (
                  <Popconfirm title="Remove the logo from future letters?" onConfirm={() => remove.mutate()}>
                    <Button icon={<DeleteOutlined />}>Remove</Button>
                  </Popconfirm>
                )}
              </Flex>
            </Form.Item>
          </Col>
        </Row>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Save letterhead
        </Button>
      </Form>
    </Card>
  );
}
