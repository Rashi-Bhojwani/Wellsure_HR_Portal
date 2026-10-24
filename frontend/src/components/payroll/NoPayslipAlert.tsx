import { Alert, Flex, Table, Typography } from "antd";
import type { NoPayslipPerson } from "../../api/payroll";
import { fs } from "../../theme/tokens";

const { Text } = Typography;

// ── Who will get no payslip: at the top of the publish step, in full, with the reason and what to do ──

export function NoPayslipAlert({ people, willGet }: { people: NoPayslipPerson[]; willGet: number }) {
  if (people.length === 0) return <Alert type="success" showIcon title={`Everyone in this run (${willGet}) will get a payslip.`} />;
  return (
    <Alert
      type="warning"
      showIcon
      data-testid="no-payslip-alert"
      title={`${people.length} ${people.length === 1 ? "person" : "people"} will get no payslip: held, not paid by this run. ${willGet} will get one.`}
      description={
        <Flex vertical gap={8}>
          <Text>Nobody on this list is paid, and nobody on this list is told anything, until the reason is put right and a run is made for them. Check it before you publish.</Text>
          <Table<NoPayslipPerson>
            size="small"
            rowKey="employeeId"
            pagination={people.length > 15 ? { pageSize: 15, showSizeChanger: false } : false}
            dataSource={people}
            columns={[
              { title: "Who", render: (_, r) => <div><Text strong>{r.name}</Text><div><Text type="secondary" style={{ fontSize: fs.sm }}>{r.employeeCode}</Text></div></div> },
              { title: "Why", render: (_, r) => <div>{r.reasonLabel}{r.detail && <div><Text type="secondary" style={{ fontSize: fs.sm }}>{r.detail}</Text></div>}</div> },
              { title: "What to do", dataIndex: "action" },
            ]}
          />
        </Flex>
      }
    />
  );
}
