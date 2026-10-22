import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Flex, List, Space, Spin, Typography, message } from "antd";
import { FilePdfOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import { PayslipView } from "../../../components/payroll/PayslipView";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";

const { Title, Text } = Typography;

// Salary → Payslips (Phase 6 P6-5): the employee's own payslips, newest first, read on screen and downloaded as a PDF. Nobody else's is ever shown here: the server only
// ever answers for the signed-in person.

export function PayslipsPage() {
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["payslips", "mine"], queryFn: payrollApi.myPayslips });
  if (isLoading) return <Spin />;
  if (error) return <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load your payslips.")} />;
  const slips = data?.payslips ?? [];
  return (
    <Flex vertical gap={16} style={{ maxWidth: 720 }}>
      <Title level={3} style={{ margin: 0 }}>
        Payslips
      </Title>
      {slips.length === 0 ? (
        <Empty description="No payslip has been published for you yet." />
      ) : (
        <List
          bordered
          dataSource={slips}
          renderItem={(s) => (
            <List.Item key={s.id} actions={[<Button key="read" type="link" onClick={() => setOpen(s.id)}>Read</Button>]}>
              <List.Item.Meta title={s.cycleLabel} description={<Text type="secondary">Published {formatDate(s.publishedAt)}</Text>} />
              <Text strong>{formatRupees(s.net, 2)}</Text>
            </List.Item>
          )}
        />
      )}
      <Drawer open={open !== null} onClose={() => setOpen(null)} size="large" title="Payslip" destroyOnHidden>
        {open && <One id={open} />}
      </Drawer>
    </Flex>
  );
}

function One({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["payslips", "mine", id], queryFn: () => payrollApi.myPayslip(id) });
  const [busy, setBusy] = useState(false);
  if (isLoading) return <Spin />;
  if (error || !data) return <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load this payslip.")} />;
  const pdf = async () => {
    setBusy(true);
    try {
      const link = await payrollApi.myPayslipPdf(id);
      if (link.ready) window.open(link.url, "_blank", "noopener");
      else void message.info(link.message);
    } catch (e) {
      void message.error(apiErrorMessage(e, "Could not get the PDF."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Button icon={<FilePdfOutlined />} loading={busy} onClick={() => void pdf()}>
        Download PDF
      </Button>
      <PayslipView content={data.content} />
    </Space>
  );
}
