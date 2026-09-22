import { useState } from "react";
import { Card, Row, Col, Segmented, Select, Button, Table, Typography, Space } from "antd";
import { DownloadOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title, Text } = Typography;

interface LineItem {
  key: string;
  component: string;
  amount: number;
}

const earnings: LineItem[] = [
  { key: "basic", component: "BASIC", amount: 3432.0 },
  { key: "hra", component: "HRA", amount: 1373.0 },
  { key: "special", component: "SPECIAL ALLOWANCE", amount: 3775.0 },
];

const earningsTotal = earnings.reduce((sum, e) => sum + e.amount, 0);

const columns = [
  { title: "Component", dataIndex: "component", key: "component" },
  {
    title: "Amount in (₹)",
    dataIndex: "amount",
    key: "amount",
    align: "right" as const,
    render: (v: number) => v.toFixed(2),
  },
];

export function PayslipsPage() {
  const [tab, setTab] = useState<string | number>("Payslip");

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Row justify="center">
        <Segmented options={["Payslip", "Reimb. Payslip"]} value={tab} onChange={setTab} />
      </Row>

      <Row justify="end" gutter={8}>
        <Col>
          <Select defaultValue="Aug 2026" style={{ width: 140 }} options={[{ value: "Aug 2026", label: "Aug 2026" }]} />
        </Col>
        <Col>
          <Button type="primary" icon={<DownloadOutlined />} />
        </Col>
      </Row>

      {tab === "Payslip" ? (
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Card title="Earnings">
              <Table
                size="small"
                pagination={false}
                columns={columns}
                dataSource={earnings}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <Text strong>Total</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Text strong>{earningsTotal.toFixed(2)}</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card title="Deductions">
              <EmptyState message="No Deductions For this month" />
              <Table
                size="small"
                pagination={false}
                columns={columns}
                dataSource={[]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <Text strong>Total</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      <Text strong>0.00</Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
                showHeader={false}
              />
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card
              title={
                <Space>
                  Employee details <InfoCircleOutlined style={{ color: "#8c8c8c" }} />
                </Space>
              }
            >
              <Text type="secondary">Net Pay for Aug 2026</Text>
              <Title level={2} style={{ color: "#1a9c5e", margin: "8px 0" }}>
                ₹8,580.00
              </Title>
              <Text type="secondary" italic>
                Rupees Eight Thousand Five Hundred Eighty Only
              </Text>
            </Card>
          </Col>
        </Row>
      ) : (
        <Card>
          <EmptyState message="No reimbursement payslip for this month" />
        </Card>
      )}
    </Space>
  );
}
