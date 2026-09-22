import { Row, Col, Card, Typography, Button, Select, Space } from "antd";
import { DownloadOutlined, PlusOutlined } from "@ant-design/icons";

const { Text, Title } = Typography;

interface LeaveTypeBalance {
  code: string;
  name: string;
  granted: number;
  balance: number;
}

// Seed leave types per docs/PROJECT_SPEC.md §5.1.
const balances: LeaveTypeBalance[] = [
  { code: "PL", name: "Privilege / Earned Leave", granted: 18.5, balance: 18.5 },
  { code: "LOP", name: "Loss Of Pay", granted: 0, balance: 0 },
  { code: "COF", name: "Comp - Off", granted: 1, balance: 1 },
  { code: "WFH", name: "Work From Home", granted: 4, balance: 2.5 },
  { code: "RH", name: "Restricted Holiday", granted: 2, balance: 2 },
];

export function LeaveBalancesPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Row justify="end" gutter={8}>
        <Col>
          <Button icon={<PlusOutlined />}>Apply</Button>
        </Col>
        <Col>
          <Button icon={<DownloadOutlined />} />
        </Col>
        <Col>
          <Select defaultValue={2026} style={{ width: 100 }} options={[{ value: 2026, label: "2026" }]} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {balances.map((b) => (
          <Col key={b.code} xs={24} sm={12} md={8} xl={4} style={{ display: "flex" }}>
            <Card style={{ width: "100%", textAlign: "center" }}>
              <Row justify="space-between" align="top">
                <Text strong style={{ fontSize: 13 }}>
                  {b.name}
                </Text>
              </Row>
              <Row justify="end">
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Granted: {b.granted}
                </Text>
              </Row>
              <Title level={2} style={{ margin: "16px 0 0" }}>
                {b.balance}
              </Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Balance
              </Text>
            </Card>
          </Col>
        ))}
      </Row>
    </Space>
  );
}
