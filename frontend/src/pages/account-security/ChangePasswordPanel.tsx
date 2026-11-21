import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Form, Input } from "antd";
import { KeyOutlined } from "@ant-design/icons";
import * as authApi from "../../api/auth";
import { setAccessToken } from "../../api/client";
import { apiErrorMessage } from "../../lib/apiError";
import { Panel, toast, useIsPhone } from "../../ui";
import { fs, space, v } from "../../theme/tokens";

// FIX-M1 (independent audit 2026-11-20): "There is no in-app change password." The current password is checked by the API; a new one ends every other session
// at once (the API raises the session version), and this device continues on the fresh token the API returns.
interface ChangePasswordForm {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export function ChangePasswordPanel({ onChanged }: { onChanged?: () => void }) {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [form] = Form.useForm<ChangePasswordForm>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFinish(values: ChangePasswordForm): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const { accessToken } = await authApi.changePassword(values.currentPassword, values.newPassword);
      setAccessToken(accessToken);
      form.resetFields();
      toast.success("Password changed. You have been signed out on every other device.");
      onChanged?.();
    } catch (err) {
      setError(apiErrorMessage(err, "The password could not be changed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Password" subtitle="Changing it signs you out on every other device.">
      <Form<ChangePasswordForm> form={form} layout="vertical" requiredMark={false} onFinish={(values) => void onFinish(values)} style={{ maxWidth: 420 }}>
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: space[4] }} />}
        <Form.Item name="currentPassword" label="Current password" rules={[{ required: true, message: "Enter your current password" }]}>
          <Input.Password autoComplete="current-password" size="large" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="New password"
          extra="At least 8 characters, with an upper-case letter, a lower-case letter and a number."
          rules={[{ required: true, message: "Enter a new password" }, { min: 8, message: "At least 8 characters" }]}
        >
          <Input.Password autoComplete="new-password" size="large" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="New password again"
          dependencies={["newPassword"]}
          rules={[
            { required: true, message: "Enter the new password again" },
            ({ getFieldValue }) => ({ validator: (_, value) => (!value || value === getFieldValue("newPassword") ? Promise.resolve() : Promise.reject(new Error("The two new passwords are not the same"))) }),
          ]}
        >
          <Input.Password autoComplete="new-password" size="large" />
        </Form.Item>
        <div style={{ display: "flex", flexWrap: "wrap", gap: space[3] }}>
          <Button type="primary" htmlType="submit" size="large" loading={saving} block={phone}>
            Change password
          </Button>
          <Button icon={<KeyOutlined />} size="large" block={phone} onClick={() => navigate("/forgot-password")}>
            Forgot it? Reset by email
          </Button>
        </div>
        <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: space[3] }}>The reset link goes to the personal email on file and is valid for 1 hour.</div>
      </Form>
    </Panel>
  );
}
