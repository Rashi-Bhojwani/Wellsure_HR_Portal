import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Col, Result, Row, Space, Tag, Typography } from "antd";
import * as reportsApi from "../../../api/reports";
import { useAuth } from "../../../hooks/useAuth";

const { Title, Text } = Typography;

// Reports app landing page (Phase 5 commit F): the reports this viewer can
// open. Attendance and payroll reports arrive with Phases 3 and 6.
export function ReportsHomePage() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission("reports.view");
  const { data: reports = [], isLoading } = useQuery({ queryKey: ["reports", "catalog"], queryFn: reportsApi.catalog, enabled: allowed });
  if (!allowed) return <Result status="403" title="You can't open reports" />;
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>
          Reports
        </Title>
        <Text type="secondary">Filter, review on screen, and export to Excel. Managers see their own team. Attendance and payroll reports arrive with those modules.</Text>
      </div>
      <Row gutter={[16, 16]}>
        {(isLoading ? [] : reports).map((r) => (
          <Col key={r.key} xs={24} sm={12} lg={8}>
            <Link to={`/admin/reports/${r.key}`}>
              <Card hoverable title={r.title} extra={r.extraPermission ? <Tag color="gold">Salary-derived</Tag> : null} style={{ height: "100%" }}>
                <Text type="secondary">{r.description}</Text>
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </Space>
  );
}
