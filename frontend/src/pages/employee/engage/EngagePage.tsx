import { Avatar, Card, Col, Row, Radio, Input, Select, Space, Typography, Button, Collapse } from "antd";
import { SearchOutlined, SmileOutlined, TrophyOutlined } from "@ant-design/icons";

const { Text, Title } = Typography;

interface FeedPost {
  id: string;
  group: string;
  time: string;
  headline: string;
  message: string;
  emoji: string;
}

const posts: FeedPost[] = [
  {
    id: "1",
    group: "Events",
    time: "a day ago",
    headline: "Priya just joined us!",
    message:
      "Priya Nair has joined us in the company on 12 Sep 2026. Please join us in welcoming our newest team member.",
    emoji: "🎉",
  },
  {
    id: "2",
    group: "Milestones",
    time: "2 days ago",
    headline: "Congratulations, Rohan!",
    message: "Our congratulations to Rohan Mehta on completing 2 successful year(s).",
    emoji: "🏆",
  },
  {
    id: "3",
    group: "Celebrations",
    time: "3 days ago",
    headline: "Happy Birthday, Simran!",
    message: "Wishing Simran Kaur a fantastic birthday, filled with joy and celebration!",
    emoji: "🎂",
  },
];

export function EngagePage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Space>
              <Avatar size={48} style={{ background: "#2f6fed" }}>
                A
              </Avatar>
              <Title level={4} style={{ margin: 0 }}>
                Hey Aditi, ready to dive in?
              </Title>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button icon={<TrophyOutlined />}>Give Kudos</Button>
              <Button type="primary" icon={<SmileOutlined />}>
                Create Poll
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={16}>
        <Col xs={24} md={7} lg={6}>
          <Card title="Filters" size="small">
            <Text strong style={{ fontSize: 12 }}>
              ACTIVITIES
            </Text>
            <Radio.Group defaultValue="all" style={{ display: "block", marginTop: 8, marginBottom: 16 }}>
              <Space orientation="vertical">
                <Radio value="all">All Activities</Radio>
                <Radio value="kudos">Kudos</Radio>
                <Radio value="polls">Polls</Radio>
                <Radio value="posts">Posts</Radio>
              </Space>
            </Radio.Group>
            <Input prefix={<SearchOutlined />} placeholder="Search" style={{ marginBottom: 16 }} />
            <Collapse
              ghost
              size="small"
              items={[
                { key: "groups", label: "Groups", children: <Text type="secondary">All groups</Text> },
                { key: "location", label: "Location", children: <Text type="secondary">All locations</Text> },
                { key: "department", label: "Department", children: <Text type="secondary">All departments</Text> },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} md={17} lg={18}>
          <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
            <Text strong>All Activities - All Groups</Text>
            <Select
              size="small"
              defaultValue="newest"
              style={{ width: 160 }}
              options={[{ value: "newest", label: "Sort: Newest first" }]}
            />
          </Row>

          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            {posts.map((post) => (
              <Card key={post.id} size="small">
                <Row justify="space-between">
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Group: {post.group}
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {post.time}
                  </Text>
                </Row>
                <Row gutter={16} align="middle" style={{ marginTop: 8 }}>
                  <Col>
                    <div style={{ fontSize: 40 }}>{post.emoji}</div>
                  </Col>
                  <Col flex="auto">
                    <Text strong style={{ fontSize: 15, display: "block" }}>
                      {post.headline}
                    </Text>
                    <Text>{post.message}</Text>
                  </Col>
                </Row>
                <Row style={{ marginTop: 12 }}>
                  <Button size="small">😊 Reaction</Button>
                </Row>
              </Card>
            ))}
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
