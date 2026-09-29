import { useQuery } from "@tanstack/react-query";
import { Card, Col, Row, Typography, List, Space, Badge, Tag } from "antd";
import {
  ArrowRightOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Link } from "react-router-dom";
import * as leaveApi from "../../../api/leave";
import * as announcementsApi from "../../../api/announcements";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAuth } from "../../../hooks/useAuth";

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

const WEEKDAY_FORMAT = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
const DAY_MONTH_FORMAT = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });

export function HomePage() {
  const quote = QUOTES[new Date().getDate() % QUOTES.length]!;
  const { user, hasPermission } = useAuth();
  const canApprove = hasPermission("leave.approve");

  const { data: pendingReview } = useQuery({
    queryKey: ["leave", "requests", "review-queue"],
    queryFn: () => leaveApi.listLeaveRequests({ status: "PENDING", pageSize: 1 }),
    enabled: canApprove,
  });
  const pendingCount = pendingReview?.total ?? 0;

  const { data: myPending } = useQuery({
    queryKey: ["leave", "requests", "my-pending"],
    queryFn: () => leaveApi.listLeaveRequests({ status: "PENDING", pageSize: 5 }),
  });

  const { data: holidays } = useQuery({
    queryKey: ["leave", "holidays", "upcoming"],
    queryFn: () => leaveApi.listHolidays(),
  });
  const upcomingHolidays = (holidays ?? [])
    .filter((h) => new Date(h.date).getTime() >= new Date().setHours(0, 0, 0, 0))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  const { data: announcement } = useQuery({
    queryKey: ["announcements", "active"],
    queryFn: announcementsApi.getActiveAnnouncement,
  });

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Title level={3} style={{ marginBottom: 4 }}>
              {greeting()}, {user?.fullName?.split(" ")[0] ?? ""}
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

      {announcement && (
        <Card>
          <Row align="middle" justify="space-between" gutter={16}>
            <Col flex="auto">
              <Text strong>{announcement.title}</Text>
              <br />
              <Text type="secondary">{announcement.body}</Text>
            </Col>
            {announcement.linkUrl && announcement.linkLabel && (
              <Col>
                <a href={announcement.linkUrl} target="_blank" rel="noreferrer">
                  {announcement.linkLabel}
                </a>
              </Col>
            )}
          </Row>
        </Card>
      )}

      <Row gutter={[16, 12]}>
        <Col xs={24} md={12} xl={8}>
          <Card
            title={
              <Space>
                Review
                {pendingCount > 0 && <Badge count={pendingCount} />}
              </Space>
            }
            extra={<Link to="/app/todo/review"><ArrowRightOutlined /></Link>}
            style={{ height: "100%" }}
          >
            {canApprove && pendingCount > 0 ? (
              <Space orientation="vertical" size={4}>
                <Text>
                  {pendingCount} leave request{pendingCount === 1 ? "" : "s"} from your team awaiting your decision.
                </Text>
                <Link to="/app/todo/review">Go to Review →</Link>
              </Space>
            ) : (
              <EmptyState message="Nothing to review" compact />
            )}
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card
            title="Upcoming Holidays"
            extra={<Link to="/app/leave/holiday-calendar"><ArrowRightOutlined /></Link>}
            style={{ height: "100%" }}
          >
            {upcomingHolidays.length > 0 ? (
              <List
                size="small"
                dataSource={upcomingHolidays}
                renderItem={(h) => {
                  const date = new Date(h.date);
                  return (
                    <List.Item>
                      <Space>
                        <Text strong>{DAY_MONTH_FORMAT.format(date)}</Text>
                        <Text type="secondary">{WEEKDAY_FORMAT.format(date)}</Text>
                      </Space>
                      <Text>{h.name}</Text>
                    </List.Item>
                  );
                }}
              />
            ) : (
              <EmptyState message="No upcoming holidays" compact />
            )}
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card title="Track" style={{ height: "100%" }}>
            {myPending && myPending.rows.length > 0 ? (
              <List
                size="small"
                dataSource={myPending.rows}
                renderItem={(r) => (
                  <List.Item>
                    <Space orientation="vertical" size={0} style={{ width: "100%" }}>
                      <Space>
                        <Text strong>{r.leaveTypeCode}</Text>
                        <Tag color="gold">Pending</Tag>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {r.fromDate} to {r.toDate} &middot; {r.totalDays} day(s)
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            ) : (
              <EmptyState message="Nothing new to track" compact />
            )}
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card title="Payslip" style={{ height: "100%" }}>
            <EmptyState message="Payslips are coming in Phase 6" compact />
          </Card>
        </Col>

        <Col xs={24} md={12} xl={8}>
          <Card title="Quick Access" style={{ height: "100%" }}>
            <EmptyState message="Salary documents are coming in Phase 6" compact />
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
                    Coming in Phase 6 — you'll be able to submit your Income Tax declaration here.
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
                    Coming in Phase 6 — you'll be able to submit your Proof of Investments here.
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
