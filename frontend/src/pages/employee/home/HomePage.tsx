import { useState } from "react";
import { Card, Col, Row, Typography, List, Space, Button, Alert } from "antd";
import {
  ArrowRightOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FileTextOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import { EmptyState } from "../../../components/common/EmptyState";
import { MaskedAmount } from "../../../components/common/MaskedAmount";

const { Title, Text } = Typography;

const QUOTES = [
  { text: "Small daily improvements lead to stunning results.", author: "Robin Sharma" },
  { text: "Teamwork makes the dream work.", author: "John C. Maxwell" },
  { text: "Great things are done by a series of small things.", author: "Vincent Van Gogh" },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

const holidays = [
  { date: "08 Nov", weekday: "Saturday", name: "Diwali" },
  { date: "25 Dec", weekday: "Friday", name: "Christmas" },
  { date: "01 Jan", weekday: "Thursday", name: "New Year's Day" },
];

const quickAccess = [
  "Reimbursement Payslip",
  "IT Statement",
  "YTD Reports",
  "Loan Statement",
];

export function HomePage() {
  const quote = QUOTES[new Date().getDate() % QUOTES.length]!;
  const [salaryRevealed, setSalaryRevealed] = useState(false);

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Title level={3} style={{ marginBottom: 4 }}>
              {greeting()}, Aditi
            </Title>
            <Text italic type="secondary">
              "{quote.text}" — {quote.author}
            </Text>
          </Col>
          <Col>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "#eef1ff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
              }}
              aria-hidden
            >
              🙂
            </div>
          </Col>
        </Row>
      </Card>

      <Alert
        type="info"
        showIcon
        title="Welcome to the new Wellsure HR Portal"
        description="Attendance and leave now update in real time — no more waiting for a month-end sync."
        action={
          <Button size="small" type="text">
            Learn more
          </Button>
        }
      />

      <Row gutter={[16, 12]}>
        <Col xs={24} md={12} xl={8}>
          <Card
            title="Review"
            extra={<Link to="/app/todo/review"><ArrowRightOutlined /></Link>}
            style={{ height: "100%" }}
          >
            <EmptyState message="Nothing to review" compact />
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card
            title="Upcoming Holidays"
            extra={<Link to="/app/leave/holiday-calendar"><ArrowRightOutlined /></Link>}
            style={{ height: "100%" }}
          >
            <List
              size="small"
              dataSource={holidays}
              renderItem={(h) => (
                <List.Item>
                  <Space>
                    <Text strong>{h.date}</Text>
                    <Text type="secondary">{h.weekday}</Text>
                  </Space>
                  <Text>{h.name}</Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card title="Track" style={{ height: "100%" }}>
            <EmptyState message="Nothing new to track" compact />
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card
            title="Payslip"
            extra={<Link to="/app/salary/payslips"><ArrowRightOutlined /></Link>}
            style={{ height: "100%" }}
          >
            <Text type="secondary" style={{ fontSize: 12 }}>
              Aug 2026 &middot; Paid Days: 19
            </Text>
            <div style={{ marginTop: 12 }}>
              <Row>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Gross Pay
                  </Text>
                  <div>
                    <MaskedAmount value={8580} revealed={salaryRevealed} />
                  </div>
                </Col>
                <Col span={12}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Deduction
                  </Text>
                  <div>
                    <MaskedAmount value={0} revealed={salaryRevealed} />
                  </div>
                </Col>
              </Row>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Net Pay
                </Text>
                <div>
                  <MaskedAmount value={8580} revealed={salaryRevealed} color="#1a9c5e" />
                </div>
              </div>
            </div>
            <Space style={{ marginTop: 8 }}>
              <Button type="link" size="small" icon={<FileTextOutlined />} style={{ paddingLeft: 0 }}>
                Download
              </Button>
              <Button
                type="link"
                size="small"
                icon={salaryRevealed ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                onClick={() => setSalaryRevealed((r) => !r)}
              >
                {salaryRevealed ? "Hide" : "Show Salary"}
              </Button>
            </Space>
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card title="Quick Access" style={{ height: "100%" }}>
            <List
              size="small"
              dataSource={quickAccess}
              renderItem={(item) => (
                <List.Item>
                  <a>{item}</a>
                </List.Item>
              )}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Frequently used salary documents, one click away.
            </Text>
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Space orientation="vertical" size={16} style={{ width: "100%", height: "100%" }}>
            <Card size="small">
              <Space>
                <IdcardOutlined style={{ color: "#2f6fed" }} />
                <div>
                  <Text strong style={{ display: "block" }}>
                    IT Declaration
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    You can submit your Income Tax declaration once released.
                  </Text>
                </div>
              </Space>
            </Card>
            <Card size="small">
              <Space>
                <SafetyCertificateOutlined style={{ color: "#2f6fed" }} />
                <div>
                  <Text strong style={{ display: "block" }}>
                    POI (Proof of Investment)
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    You can submit your Proof of Investments once released.
                  </Text>
                </div>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
