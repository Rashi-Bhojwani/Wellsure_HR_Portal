import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Avatar,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  List,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { CommentOutlined, PlusOutlined, SearchOutlined, SmileOutlined, TrophyOutlined } from "@ant-design/icons";
import * as engageApi from "../../../api/engage";
import * as orgApi from "../../../api/org";
import { EmptyState } from "../../../components/common/EmptyState";
import { apiErrorMessage } from "../../../lib/apiError";
import { useAuth } from "../../../hooks/useAuth";

const { Text, Title } = Typography;
const { TextArea } = Input;

const REACTION_EMOJIS = ["👍", "❤️", "🎉", "😂", "👏"];

const KIND_LABEL: Record<engageApi.PostKind, string> = {
  USER: "Post",
  KUDOS: "Kudos",
  POLL: "Poll",
  AUTO_BIRTHDAY: "Birthday",
  AUTO_JOINING: "New Joiner",
  AUTO_ANNIVERSARY: "Anniversary",
};

const KIND_EMOJI: Record<engageApi.PostKind, string> = {
  USER: "💬",
  KUDOS: "🏆",
  POLL: "📊",
  AUTO_BIRTHDAY: "🎂",
  AUTO_JOINING: "🎉",
  AUTO_ANNIVERSARY: "🏆",
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}

function GiveKudosModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [toEmployeeId, setToEmployeeId] = useState<string | undefined>();
  const [msg, setMsg] = useState("");

  const { data: options = [], isFetching } = useQuery({
    queryKey: ["engage", "employee-search", search],
    queryFn: () => engageApi.searchEmployees(search),
    enabled: search.trim().length > 0,
  });

  const mutation = useMutation({
    mutationFn: () => engageApi.giveKudos({ toEmployeeId: toEmployeeId!, message: msg }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] });
      message.success("Kudos given!");
      setToEmployeeId(undefined);
      setMsg("");
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not give kudos.")),
  });

  return (
    <Modal
      title={
        <Space>
          <TrophyOutlined /> Give Kudos
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      okButtonProps={{ disabled: !toEmployeeId || !msg.trim() }}
      confirmLoading={mutation.isPending}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Select
          showSearch
          placeholder="Search for a colleague"
          style={{ width: "100%" }}
          value={toEmployeeId}
          onSearch={setSearch}
          onChange={setToEmployeeId}
          filterOption={false}
          loading={isFetching}
          options={options.map((o) => ({ value: o.id, label: `${o.name} (${o.employeeCode})` }))}
          notFoundContent={search.trim() ? "No matches" : "Type to search"}
        />
        <TextArea rows={3} placeholder="What are you recognising them for?" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} showCount />
      </Space>
    </Modal>
  );
}

function CreatePollModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);

  const mutation = useMutation({
    mutationFn: () => engageApi.createPoll({ question, options: options.map((o) => o.trim()).filter(Boolean) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] });
      message.success("Poll created!");
      setQuestion("");
      setOptions(["", ""]);
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not create poll.")),
  });

  const validOptionCount = options.map((o) => o.trim()).filter(Boolean).length;

  return (
    <Modal
      title={
        <Space>
          <SmileOutlined /> Create Poll
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={() => mutation.mutate()}
      okButtonProps={{ disabled: !question.trim() || validOptionCount < 2 }}
      confirmLoading={mutation.isPending}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Input placeholder="Ask a question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} />
        {options.map((opt, i) => (
          <Space key={i} style={{ width: "100%" }}>
            <Input
              placeholder={`Option ${i + 1}`}
              value={opt}
              onChange={(e) => {
                const next = [...options];
                next[i] = e.target.value;
                setOptions(next);
              }}
              maxLength={120}
              style={{ width: 320 }}
            />
            {options.length > 2 && (
              <Button size="small" danger type="text" onClick={() => setOptions(options.filter((_, idx) => idx !== i))}>
                Remove
              </Button>
            )}
          </Space>
        ))}
        {options.length < 10 && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => setOptions([...options, ""])}>
            Add option
          </Button>
        )}
      </Space>
    </Modal>
  );
}

function CommentsSection({ postId }: { postId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const { data: comments = [] } = useQuery({
    queryKey: ["engage", "comments", postId],
    queryFn: () => engageApi.listComments(postId),
  });

  const mutation = useMutation({
    mutationFn: () => engageApi.addComment(postId, draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "comments", postId] });
      void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] });
      setDraft("");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not post comment.")),
  });

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
      {comments.length > 0 && (
        <List
          size="small"
          dataSource={comments}
          renderItem={(c) => (
            <List.Item style={{ border: "none", padding: "4px 0" }}>
              <Space orientation="vertical" size={0}>
                <Text strong style={{ fontSize: 12 }}>
                  {c.authorName}
                </Text>
                <Text style={{ fontSize: 13 }}>{c.body}</Text>
              </Space>
            </List.Item>
          )}
        />
      )}
      <Space.Compact style={{ width: "100%", marginTop: 8 }}>
        <Input
          placeholder="Write a comment..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => draft.trim() && mutation.mutate()}
          maxLength={1000}
        />
        <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!draft.trim()}>
          Send
        </Button>
      </Space.Compact>
    </div>
  );
}

function PostCard({ post }: { post: engageApi.PostRow }) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const [commentsOpen, setCommentsOpen] = useState(false);

  const reactMutation = useMutation({
    mutationFn: (emoji: string) => engageApi.toggleReaction(post.id, emoji),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] }),
  });

  const voteMutation = useMutation({
    mutationFn: (pollOptionId: string) => engageApi.votePoll(pollOptionId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] }),
    onError: (err) => void message.error(apiErrorMessage(err, "Could not vote.")),
  });

  const hideMutation = useMutation({
    mutationFn: () => engageApi.moderatePost(post.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] });
      message.success("Post hidden from the feed.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not hide post.")),
  });

  let headline: string;
  let body = post.body;
  if (post.kind === "KUDOS" && post.kudos) {
    headline = `${post.kudos.fromName} gave kudos to ${post.kudos.toName}`;
    body = post.kudos.message;
  } else if (post.kind === "AUTO_BIRTHDAY") headline = `Happy Birthday, ${post.subjectName}!`;
  else if (post.kind === "AUTO_JOINING") headline = `${post.subjectName} just joined us!`;
  else if (post.kind === "AUTO_ANNIVERSARY") headline = `Congratulations, ${post.subjectName}!`;
  else if (post.kind === "POLL" && post.poll) headline = post.poll.question;
  else headline = post.authorName ?? "Someone";

  return (
    <Card size="small">
      <Row justify="space-between">
        <Space size={4}>
          {post.groupName && <Tag>{post.groupName}</Tag>}
          <Tag color="blue">{KIND_LABEL[post.kind]}</Tag>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {relativeTime(post.createdAt)}
        </Text>
      </Row>
      <Row gutter={16} align="middle" style={{ marginTop: 8 }}>
        <Col>
          <div style={{ fontSize: 40 }}>{KIND_EMOJI[post.kind]}</div>
        </Col>
        <Col flex="auto">
          <Text strong style={{ fontSize: 15, display: "block" }}>
            {headline}
          </Text>
          {post.kind !== "POLL" && <Text>{body}</Text>}
        </Col>
      </Row>

      {post.kind === "POLL" && post.poll && (
        <Space orientation="vertical" size={6} style={{ width: "100%", marginTop: 8 }}>
          {post.poll.options.map((o) => {
            const pct = post.poll!.totalVotes > 0 ? Math.round((o.voteCount / post.poll!.totalVotes) * 100) : 0;
            const voted = post.poll!.viewerVotedOptionId === o.id;
            const closed = post.poll!.closedAt !== null;
            return (
              <div
                key={o.id}
                onClick={() => !closed && voteMutation.mutate(o.id)}
                style={{
                  position: "relative",
                  border: voted ? "1px solid #2f6fed" : "1px solid #f0f0f0",
                  borderRadius: 6,
                  padding: "6px 10px",
                  cursor: closed ? "default" : "pointer",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "#eef1ff", zIndex: 0 }} />
                <Row justify="space-between" style={{ position: "relative", zIndex: 1 }}>
                  <Text>{o.label}{voted ? " ✓" : ""}</Text>
                  <Text type="secondary">{o.voteCount} ({pct}%)</Text>
                </Row>
              </div>
            );
          })}
          <Text type="secondary" style={{ fontSize: 12 }}>
            {post.poll.totalVotes} vote{post.poll.totalVotes === 1 ? "" : "s"} {post.poll.closedAt ? "· Closed" : ""}
          </Text>
        </Space>
      )}

      <Row style={{ marginTop: 12 }} justify="space-between" align="middle">
        <Space size={4} wrap>
          {REACTION_EMOJIS.map((emoji) => {
            const found = post.reactions.find((r) => r.emoji === emoji);
            return (
              <Button
                key={emoji}
                size="small"
                type={post.viewerReaction === emoji ? "primary" : "default"}
                onClick={() => reactMutation.mutate(emoji)}
              >
                {emoji} {found ? found.count : ""}
              </Button>
            );
          })}
        </Space>
        <Space>
          <Button size="small" icon={<CommentOutlined />} onClick={() => setCommentsOpen((v) => !v)}>
            {post.commentCount}
          </Button>
          {hasPermission("engage.moderate") && (
            <Button size="small" danger type="text" onClick={() => hideMutation.mutate()} loading={hideMutation.isPending}>
              Hide
            </Button>
          )}
        </Space>
      </Row>

      {commentsOpen && <CommentsSection postId={post.id} />}
    </Card>
  );
}

export function EngagePage({ initialActivity = "all" }: { initialActivity?: "all" | "KUDOS" | "POLL" | "USER" }) {
  const { user } = useAuth();
  const [activity, setActivity] = useState<"all" | "KUDOS" | "POLL" | "USER">(initialActivity);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [locationId, setLocationId] = useState<string | undefined>();
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [kudosOpen, setKudosOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const queryClient = useQueryClient();
  const { data: groups = [] } = useQuery({ queryKey: ["engage", "groups", "active"], queryFn: engageApi.listActiveGroups });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list });

  const { data: feed, isLoading } = useQuery({
    queryKey: ["engage", "feed", activity, groupId, locationId, departmentId, search],
    queryFn: () =>
      engageApi.listFeed({
        kind: activity === "all" ? undefined : activity,
        groupId,
        locationId,
        departmentId,
        search: search.trim() || undefined,
        pageSize: 30,
      }),
  });

  const postMutation = useMutation({
    mutationFn: () => engageApi.createPost({ body: draft }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] });
      setDraft("");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not post.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Row align="middle" gutter={16}>
          <Col flex="auto">
            <Space>
              <Avatar size={48} style={{ background: "#2f6fed" }}>
                {user?.fullName?.[0] ?? "?"}
              </Avatar>
              <Title level={4} style={{ margin: 0 }}>
                Hey {user?.fullName?.split(" ")[0] ?? ""}, ready to dive in?
              </Title>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button icon={<TrophyOutlined />} onClick={() => setKudosOpen(true)}>
                Give Kudos
              </Button>
              <Button type="primary" icon={<SmileOutlined />} onClick={() => setPollOpen(true)}>
                Create Poll
              </Button>
            </Space>
          </Col>
        </Row>
        <Space.Compact style={{ width: "100%", marginTop: 12 }}>
          <Input placeholder="Share an update..." value={draft} onChange={(e) => setDraft(e.target.value)} onPressEnter={() => draft.trim() && postMutation.mutate()} maxLength={2000} />
          <Button onClick={() => postMutation.mutate()} loading={postMutation.isPending} disabled={!draft.trim()}>
            Post
          </Button>
        </Space.Compact>
      </Card>

      <Row gutter={16}>
        <Col xs={24} md={7} lg={6}>
          <Card title="Filters" size="small">
            <Text strong style={{ fontSize: 12 }}>
              ACTIVITIES
            </Text>
            <Radio.Group value={activity} onChange={(e) => setActivity(e.target.value as typeof activity)} style={{ display: "block", marginTop: 8, marginBottom: 16 }}>
              <Space orientation="vertical">
                <Radio value="all">All Activities</Radio>
                <Radio value="KUDOS">Kudos</Radio>
                <Radio value="POLL">Polls</Radio>
                <Radio value="USER">Posts</Radio>
              </Space>
            </Radio.Group>
            <Input prefix={<SearchOutlined />} placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 16 }} allowClear />
            <Collapse
              ghost
              size="small"
              items={[
                {
                  key: "groups",
                  label: "Groups",
                  children: (
                    <Select
                      allowClear
                      placeholder="All groups"
                      style={{ width: "100%" }}
                      value={groupId}
                      onChange={setGroupId}
                      options={groups.map((g) => ({ value: g.id, label: g.name }))}
                    />
                  ),
                },
                {
                  key: "location",
                  label: "Location",
                  children: (
                    <Select
                      allowClear
                      placeholder="All locations"
                      style={{ width: "100%" }}
                      value={locationId}
                      onChange={setLocationId}
                      options={locations.map((l) => ({ value: l.id, label: l.name }))}
                    />
                  ),
                },
                {
                  key: "department",
                  label: "Department",
                  children: (
                    <Select
                      allowClear
                      placeholder="All departments"
                      style={{ width: "100%" }}
                      value={departmentId}
                      onChange={setDepartmentId}
                      options={departments.map((d) => ({ value: d.id, label: d.name }))}
                    />
                  ),
                },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} md={17} lg={18}>
          <Row justify="space-between" align="middle" style={{ marginBottom: 12 }}>
            <Text strong>
              {activity === "all" ? "All Activities" : KIND_LABEL[activity]} - {groups.find((g) => g.id === groupId)?.name ?? "All Groups"}
            </Text>
            <Select size="small" defaultValue="newest" style={{ width: 160 }} options={[{ value: "newest", label: "Sort: Newest first" }]} />
          </Row>

          {isLoading ? (
            <Empty description="Loading..." />
          ) : feed && feed.rows.length > 0 ? (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {feed.rows.map((post) => (
                <PostCard key={post.id} post={post} />
              ))}
            </Space>
          ) : (
            <EmptyState message="Nothing to show yet — be the first to post, give kudos, or start a poll." />
          )}
        </Col>
      </Row>

      <GiveKudosModal open={kudosOpen} onClose={() => setKudosOpen(false)} />
      <CreatePollModal open={pollOpen} onClose={() => setPollOpen(false)} />
    </Space>
  );
}
