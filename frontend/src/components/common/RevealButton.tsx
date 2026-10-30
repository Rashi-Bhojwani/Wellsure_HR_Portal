import { useState } from "react";
import { Button, Form, Input } from "antd";
import { EyeOutlined } from "@ant-design/icons";
import { ConfirmModal } from "../../ui";

// Showing a masked bank or identity number in full is audited, and it needs a reason (owner decision): a few words, kept in the audit row beside who looked and when.
// The number itself is never written anywhere. The reason is asked for here, before the request is made.

export function RevealButton({ label, loading, onReveal }: { label: string; loading: boolean; onReveal: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= 3;
  return (
    <>
      <Button icon={<EyeOutlined />} loading={loading} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <ConfirmModal
          open
          title={label}
          description="Showing this in full is recorded, with your name, the time and the reason you give. The number itself is never written down."
          confirmLabel="Show it"
          cancelLabel="Cancel"
          confirmDisabled={!ready}
          loading={loading}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            onReveal(reason.trim());
            setOpen(false);
            setReason("");
          }}
        >
          <Form layout="vertical" component="div" requiredMark={false}>
            <Form.Item label="Why do you need to see it?" htmlFor="reveal-reason" help="A few words at least." style={{ marginBottom: 0 }}>
              <Input.TextArea id="reveal-reason" autoFocus rows={2} maxLength={200} showCount value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: checking the bank account against the passbook" />
            </Form.Item>
          </Form>
        </ConfirmModal>
      )}
    </>
  );
}
