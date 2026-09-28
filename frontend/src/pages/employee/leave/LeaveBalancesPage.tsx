import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Row, Col, Card, Typography, Button, Select, Space, Spin } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as leaveApi from "../../../api/leave";
import { EmptyState } from "../../../components/common/EmptyState";

const { Text, Title } = Typography;

export function LeaveBalancesPage() {
  const navigate = useNavigate();
  const { data: balances = [], isLoading } = useQuery({ queryKey: ["leave", "balances", "me"], queryFn: () => leaveApi.getLeaveBalances() });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Row justify="end" gutter={8}>
        <Col>
          <Button icon={<PlusOutlined />} onClick={() => navigate("/app/leave/apply")}>
            Apply
          </Button>
        </Col>
        <Col>
          <Select defaultValue={new Date().getFullYear()} style={{ width: 100 }} options={[{ value: new Date().getFullYear(), label: String(new Date().getFullYear()) }]} />
        </Col>
      </Row>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : balances.length === 0 ? (
        <EmptyState message="No leave types configured yet." />
      ) : (
        <Row gutter={[16, 16]}>
          {balances.map((b) => (
            <Col key={b.leaveTypeId} xs={24} sm={12} md={8} xl={4} style={{ display: "flex" }}>
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
      )}
    </Space>
  );
}
