import { useState, type CSSProperties, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Radio, Select, Tooltip } from "antd";
import { CheckOutlined, CommentOutlined, EyeInvisibleOutlined, PlusOutlined, SearchOutlined, SendOutlined, SmileOutlined, TrophyOutlined } from "@ant-design/icons";
import * as engageApi from "../../../api/engage";
import * as orgApi from "../../../api/org";
import { apiErrorMessage } from "../../../lib/apiError";
import { useAuth } from "../../../hooks/useAuth";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { EmptyState, FilterBar, InitialsAvatar, PageHeader, Panel, SideDrawer, Skel, Stack, StatusChip, toast, useDebouncedValue, useIsPhone } from "../../../ui";

const { TextArea } = Input;

const REACTION_EMOJIS = ["👍", "❤️", "🎉", "😂", "👏"];

type Activity = "all" | "KUDOS" | "POLL" | "USER";

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

const KIND_TONE: Record<engageApi.PostKind, "info" | "warning" | "purple" | "success"> = {
  USER: "info",
  KUDOS: "warning",
  POLL: "purple",
  AUTO_BIRTHDAY: "success",
  AUTO_JOINING: "success",
  AUTO_ANNIVERSARY: "success",
};

// The tinted band behind a celebration post's big avatar.
const BAND_BG: Partial<Record<engageApi.PostKind, string>> = {
  AUTO_BIRTHDAY: v.accentSubtle,
  AUTO_JOINING: v.infoSubtle,
  AUTO_ANNIVERSARY: v.warningSubtle,
  KUDOS: v.warningSubtle,
};

const ACTIVITY_OPTIONS: { value: Activity; label: string }[] = [
  { value: "all", label: "All Activities" },
  { value: "KUDOS", label: "Kudos" },
  { value: "POLL", label: "Polls" },
  { value: "USER", label: "Posts" },
];

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

const fieldLabel: CSSProperties = { display: "block", fontSize: fs.md, fontWeight: fw.medium, color: v.textPrimary, marginBottom: space[2] };

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
      toast.success("Kudos given!");
      setToEmployeeId(undefined);
      setMsg("");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not give kudos.")),
  });

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Give Kudos"
      subtitle="Recognise a colleague in front of the whole company."
      primaryLabel="Give Kudos"
      onPrimary={() => mutation.mutate()}
      primaryDisabled={!toEmployeeId || !msg.trim()}
      primaryLoading={mutation.isPending}
      destroyOnHidden={false}
    >
      <Stack gap={space[5]}>
        <div>
          <label htmlFor="kudos-to" style={fieldLabel}>
            Colleague
          </label>
          <Select
            id="kudos-to"
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
        </div>
        <div>
          <label htmlFor="kudos-msg" style={fieldLabel}>
            Message
          </label>
          <TextArea id="kudos-msg" rows={4} placeholder="What are you recognising them for?" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={500} showCount />
        </div>
      </Stack>
    </SideDrawer>
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
      toast.success("Poll created!");
      setQuestion("");
      setOptions(["", ""]);
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create poll.")),
  });

  const validOptionCount = options.map((o) => o.trim()).filter(Boolean).length;

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Create Poll"
      subtitle="Ask the company a question with 2 to 10 options."
      primaryLabel="Create Poll"
      onPrimary={() => mutation.mutate()}
      primaryDisabled={!question.trim() || validOptionCount < 2}
      primaryLoading={mutation.isPending}
      destroyOnHidden={false}
    >
      <Stack gap={space[5]}>
        <div>
          <label htmlFor="poll-q" style={fieldLabel}>
            Question
          </label>
          <Input id="poll-q" placeholder="Ask a question" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} />
        </div>
        <div>
          <span style={fieldLabel}>Options</span>
          <Stack gap={space[3]}>
            {options.map((opt, i) => (
              <div key={i} style={{ display: "flex", gap: space[2], alignItems: "center" }}>
                <Input
                  aria-label={`Option ${i + 1}`}
                  placeholder={`Option ${i + 1}`}
                  value={opt}
                  onChange={(e) => {
                    const next = [...options];
                    next[i] = e.target.value;
                    setOptions(next);
                  }}
                  maxLength={120}
                  style={{ flex: 1 }}
                />
                {options.length > 2 && (
                  <Button danger type="text" onClick={() => setOptions(options.filter((_, idx) => idx !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </Stack>
          {options.length < 10 && (
            <Button icon={<PlusOutlined />} onClick={() => setOptions([...options, ""])} style={{ marginTop: space[3] }}>
              Add option
            </Button>
          )}
        </div>
      </Stack>
    </SideDrawer>
  );
}

function CommentsSection({ postId }: { postId: string }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const { data: comments = [], isLoading } = useQuery({
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
    onError: (err) => toast.error(apiErrorMessage(err, "Could not post comment.")),
  });

  return (
    <div style={{ marginTop: space[4], borderTop: `1px solid ${v.borderDefault}`, paddingTop: space[4], display: "flex", flexDirection: "column", gap: space[3] }}>
      {isLoading && (
        <div style={{ display: "flex", gap: space[3], alignItems: "center" }}>
          <Skel w={28} h={28} r={radius.pill} />
          <Skel w="50%" h={12} />
        </div>
      )}
      {comments.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: space[3], alignItems: "flex-start" }}>
          <InitialsAvatar name={c.authorName} size={28} />
          <div style={{ background: v.bgSubtle, borderRadius: radius.md, padding: `${space[2]}px ${space[3]}px`, minWidth: 0 }}>
            <div style={{ fontSize: fs.sm, fontWeight: fw.semibold, color: v.textPrimary }}>
              {c.authorName} <span style={{ fontWeight: fw.regular, color: v.textSecondary, marginLeft: space[1] }}>{relativeTime(c.createdAt)}</span>
            </div>
            <div style={{ fontSize: fs.table, color: v.textBody, wordBreak: "break-word" }}>{c.body}</div>
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: space[2] }}>
        <Input
          aria-label="Write a comment"
          placeholder="Write a comment..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => draft.trim() && mutation.mutate()}
          maxLength={1000}
        />
        <Button icon={<SendOutlined />} onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!draft.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}

function PostCard({ post }: { post: engageApi.PostRow }) {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const phone = useIsPhone();
  const [commentsOpen, setCommentsOpen] = useState(false);

  const reactMutation = useMutation({
    mutationFn: (emoji: string) => engageApi.toggleReaction(post.id, emoji),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] }),
  });

  const voteMutation = useMutation({
    mutationFn: (pollOptionId: string) => engageApi.votePoll(pollOptionId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] }),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not vote.")),
  });

  const hideMutation = useMutation({
    mutationFn: () => engageApi.moderatePost(post.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] });
      toast.success("Post hidden from the feed.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not hide post.")),
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

  const celebration = post.kind === "AUTO_BIRTHDAY" || post.kind === "AUTO_JOINING" || post.kind === "AUTO_ANNIVERSARY";
  const authorName = post.kind === "KUDOS" ? (post.kudos?.fromName ?? post.authorName) : celebration ? "Celebrations" : post.authorName;
  const bandName = post.kind === "KUDOS" ? post.kudos?.toName : post.subjectName;
  const band = (celebration || post.kind === "KUDOS") && bandName;

  return (
    <article style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: phone ? space[4] : space[5] }}>
      {/* Author row */}
      <header style={{ display: "flex", alignItems: "center", gap: space[3] }}>
        {celebration ? (
          <span aria-hidden style={{ width: 40, height: 40, borderRadius: radius.pill, background: v.bgSubtle, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.xl, flex: "none" }}>
            {KIND_EMOJI[post.kind]}
          </span>
        ) : (
          <InitialsAvatar name={authorName ?? "?"} size={40} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: fw.semibold, color: v.textPrimary, fontSize: fs.md, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{authorName ?? "Someone"}</div>
          <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{relativeTime(post.createdAt)}</div>
        </div>
        <div style={{ display: "flex", gap: space[1], flexWrap: "wrap", justifyContent: "flex-end" }}>
          {post.groupName && <StatusChip tone="neutral">{post.groupName}</StatusChip>}
          <StatusChip tone={KIND_TONE[post.kind]}>{KIND_LABEL[post.kind]}</StatusChip>
        </div>
      </header>

      {/* Celebration / kudos band with a big initials avatar */}
      {band ? (
        <div
          style={{
            marginTop: space[4],
            background: BAND_BG[post.kind] ?? v.accentSubtle,
            borderRadius: radius.md,
            padding: phone ? space[4] : space[5],
            display: "flex",
            alignItems: "center",
            gap: space[4],
            flexDirection: phone ? "column" : "row",
            textAlign: phone ? "center" : "left",
          }}
        >
          <span style={{ position: "relative", flex: "none" }}>
            <InitialsAvatar name={bandName} size={72} />
            <span aria-hidden style={{ position: "absolute", right: -6, bottom: -4, fontSize: fs.h2 }}>
              {KIND_EMOJI[post.kind]}
            </span>
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: fw.bold, fontSize: fs.lg, color: v.textPrimary }}>{headline}</div>
            {body && <div style={{ color: v.textBody, fontSize: fs.md, marginTop: space[1], whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{body}</div>}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: space[3] }}>
          {post.kind === "POLL" && <div style={{ fontWeight: fw.semibold, fontSize: fs.lg, color: v.textPrimary }}>{headline}</div>}
          {post.kind !== "POLL" && <div style={{ color: v.textBody, fontSize: fs.md, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{body}</div>}
        </div>
      )}

      {post.kind === "POLL" && post.poll && (
        <div role="group" aria-label="Poll options" style={{ display: "flex", flexDirection: "column", gap: space[2], marginTop: space[3] }}>
          {post.poll.options.map((o) => {
            const pct = post.poll!.totalVotes > 0 ? Math.round((o.voteCount / post.poll!.totalVotes) * 100) : 0;
            const voted = post.poll!.viewerVotedOptionId === o.id;
            const closed = post.poll!.closedAt !== null;
            return (
              <button
                type="button"
                key={o.id}
                disabled={closed}
                aria-pressed={voted}
                onClick={() => !closed && voteMutation.mutate(o.id)}
                style={{
                  position: "relative",
                  border: `1px solid ${voted ? v.accent : v.borderDefault}`,
                  borderRadius: radius.md,
                  padding: `${space[3]}px ${space[4]}px`,
                  cursor: closed ? "default" : "pointer",
                  overflow: "hidden",
                  background: v.bgSurface,
                  textAlign: "left",
                  font: "inherit",
                  color: v.textBody,
                }}
              >
                <span aria-hidden style={{ position: "absolute", inset: 0, width: `${pct}%`, background: v.accentSubtle, transition: "width 0.3s" }} />
                <span style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: space[3] }}>
                  <span style={{ fontWeight: voted ? fw.semibold : fw.regular }}>
                    {o.label}
                    {voted && <CheckOutlined style={{ marginLeft: space[2], color: v.accentText }} aria-label="Your vote" />}
                  </span>
                  <span style={{ color: v.textSecondary, fontVariantNumeric: "tabular-nums" }}>
                    {o.voteCount} ({pct}%)
                  </span>
                </span>
              </button>
            );
          })}
          <span style={{ color: v.textSecondary, fontSize: fs.sm }}>
            {post.poll.totalVotes} vote{post.poll.totalVotes === 1 ? "" : "s"} {post.poll.closedAt ? "· Closed" : ""}
          </span>
        </div>
      )}

      {/* Reactions and comments */}
      <div style={{ marginTop: space[4], paddingTop: space[3], borderTop: `1px solid ${v.borderDefault}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
          {REACTION_EMOJIS.map((emoji) => {
            const found = post.reactions.find((r) => r.emoji === emoji);
            const mine = post.viewerReaction === emoji;
            return (
              <button
                type="button"
                key={emoji}
                aria-pressed={mine}
                aria-label={`React ${emoji}${found ? `, ${found.count}` : ""}`}
                onClick={() => reactMutation.mutate(emoji)}
                style={{
                  minWidth: phone ? 44 : 40,
                  height: phone ? 40 : 32,
                  padding: `0 ${space[2]}px`,
                  borderRadius: radius.pill,
                  border: `1px solid ${mine ? v.accent : v.borderDefault}`,
                  background: mine ? v.accentSubtle : v.bgSurface,
                  color: v.textBody,
                  fontSize: fs.table,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space[1],
                }}
              >
                <span aria-hidden>{emoji}</span>
                {found && <span style={{ fontWeight: fw.semibold }}>{found.count}</span>}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: space[2] }}>
          <Button type="text" icon={<CommentOutlined />} onClick={() => setCommentsOpen((o) => !o)} aria-expanded={commentsOpen}>
            {post.commentCount} {post.commentCount === 1 ? "comment" : "comments"}
          </Button>
          {hasPermission("engage.moderate") && (
            <Tooltip title="Hide this post from the feed">
              <Button danger type="text" icon={<EyeInvisibleOutlined />} onClick={() => hideMutation.mutate()} loading={hideMutation.isPending}>
                Hide
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {commentsOpen && <CommentsSection postId={post.id} />}
    </article>
  );
}

function PostSkeleton() {
  return (
    <div aria-hidden style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5] }}>
      <div style={{ display: "flex", gap: space[3], alignItems: "center" }}>
        <Skel w={40} h={40} r={radius.pill} />
        <div style={{ flex: 1 }}>
          <Skel w="30%" h={12} style={{ marginBottom: space[2] }} />
          <Skel w="18%" h={10} />
        </div>
      </div>
      <Skel w="90%" style={{ marginTop: space[4] }} />
      <Skel w="70%" style={{ marginTop: space[2] }} />
      <Skel w="40%" h={28} r={radius.pill} style={{ marginTop: space[4] }} />
    </div>
  );
}

function ActionTile({ icon, label, hint, onClick, tone }: { icon: ReactNode; label: string; hint: string; onClick: () => void; tone: { bg: string; fg: string } }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[3],
        padding: space[3],
        paddingRight: space[4],
        border: `1px solid ${v.borderDefault}`,
        borderRadius: radius.md,
        background: v.bgSurface,
        cursor: "pointer",
        textAlign: "left",
        font: "inherit",
        flex: "1 1 180px",
        minWidth: 0,
      }}
    >
      <span aria-hidden style={{ width: 40, height: 40, borderRadius: radius.pill, background: tone.bg, color: tone.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.lg, flex: "none" }}>
        {icon}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: fw.semibold, color: v.textPrimary, fontSize: fs.md }}>{label}</span>
        <span style={{ display: "block", color: v.textSecondary, fontSize: fs.sm }}>{hint}</span>
      </span>
    </button>
  );
}

export function EngagePage({ initialActivity = "all" }: { initialActivity?: Activity }) {
  const { user } = useAuth();
  const [activity, setActivity] = useState<Activity>(initialActivity);
  const [groupId, setGroupId] = useState<string | undefined>();
  const [locationId, setLocationId] = useState<string | undefined>();
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [searchText, setSearchText] = useState("");
  const search = useDebouncedValue(searchText, 250);
  const isPhone = useIsPhone();
  const [kudosOpen, setKudosOpen] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const queryClient = useQueryClient();
  const { data: groups = [] } = useQuery({ queryKey: ["engage", "groups", "active"], queryFn: engageApi.listActiveGroups, staleTime: 30_000 });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), staleTime: 30_000 });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, staleTime: 30_000 });

  const { data: feed, isLoading, error, refetch } = useQuery({
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
    // Live updates (useEngageRealtime) and filter changes refetch in place: the old cards stay until the new ones arrive, so nothing flashes.
    placeholderData: keepPreviousData,
  });

  const postMutation = useMutation({
    mutationFn: () => engageApi.createPost({ body: draft }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "feed"] });
      setDraft("");
      setComposerOpen(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not post.")),
  });

  const activeCount = [groupId, locationId, departmentId, activity !== "all" ? activity : undefined].filter(Boolean).length;
  const clearFilters = () => {
    setActivity("all");
    setGroupId(undefined);
    setLocationId(undefined);
    setDepartmentId(undefined);
  };

  const selects = (
    <>
      <Select allowClear aria-label="Group" placeholder="All groups" style={{ width: "100%" }} value={groupId} onChange={setGroupId} options={groups.map((g) => ({ value: g.id, label: g.name }))} />
      <Select allowClear aria-label="Location" placeholder="All locations" style={{ width: "100%" }} value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
      <Select allowClear aria-label="Department" placeholder="All departments" style={{ width: "100%" }} value={departmentId} onChange={setDepartmentId} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
    </>
  );

  const groupLabel: CSSProperties = { fontSize: fs.xs, fontWeight: fw.semibold, color: v.textSecondary, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: space[2], display: "block" };

  const activityRadios = (
    <Radio.Group value={activity} onChange={(e) => setActivity(e.target.value as Activity)} style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
      {ACTIVITY_OPTIONS.map((o) => (
        <Radio key={o.value} value={o.value}>
          {o.label}
        </Radio>
      ))}
    </Radio.Group>
  );

  const filterPanel = (
    <Panel title="Filters" extra={activeCount > 0 ? <Button type="link" onClick={clearFilters}>Clear</Button> : undefined} style={{ position: "sticky", top: space[6] }}>
      <Stack gap={space[5]}>
        <div>
          <span style={groupLabel}>Activities</span>
          {activityRadios}
        </div>
        <Input prefix={<SearchOutlined aria-hidden />} aria-label="Search the feed" placeholder="Search" value={searchText} onChange={(e) => setSearchText(e.target.value)} allowClear />
        <div>
          <span style={groupLabel}>Groups, location and department</span>
          <Stack gap={space[3]}>{selects}</Stack>
        </div>
      </Stack>
    </Panel>
  );

  const firstName = user?.fullName?.split(" ")[0] ?? "";
  const composer = (
    <div style={{ display: "flex", gap: space[3], alignItems: "flex-start" }}>
      {!isPhone && <InitialsAvatar name={user?.fullName ?? "?"} size={40} />}
      <TextArea
        aria-label="Share an update"
        placeholder="Share an update..."
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onPressEnter={(e) => {
          if (!e.shiftKey && !isPhone) {
            e.preventDefault();
            if (draft.trim()) postMutation.mutate();
          }
        }}
        maxLength={2000}
        autoSize={{ minRows: isPhone ? 4 : 1, maxRows: 8 }}
        style={{ flex: 1 }}
      />
      {!isPhone && (
        <Button type="primary" icon={<SendOutlined />} onClick={() => postMutation.mutate()} loading={postMutation.isPending} disabled={!draft.trim()}>
          Post
        </Button>
      )}
    </div>
  );

  const feedTitle = `${activity === "all" ? "All Activities" : KIND_LABEL[activity]} - ${groups.find((g) => g.id === groupId)?.name ?? "All Groups"}`;

  const feedList = isLoading ? (
    <Stack gap={space[4]}>
      <PostSkeleton />
      <PostSkeleton />
      <PostSkeleton />
    </Stack>
  ) : error && !feed ? (
    <Panel>
      <EmptyState kind="error" description={apiErrorMessage(error, "We couldn't load the feed. Try again.")} onRetry={() => void refetch()} />
    </Panel>
  ) : feed && feed.rows.length > 0 ? (
    <Stack gap={space[4]}>
      {feed.rows.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </Stack>
  ) : (
    <Panel>
      <EmptyState
        kind={activeCount > 0 || search ? "no-results" : "empty"}
        illustration="people"
        title="Nothing to show yet"
        description="Be the first to post, give kudos, or start a poll."
        action={
          activeCount > 0 ? (
            <Button onClick={clearFilters}>Clear filters</Button>
          ) : (
            <Button type="primary" icon={<TrophyOutlined />} onClick={() => setKudosOpen(true)}>
              Give Kudos
            </Button>
          )
        }
      />
    </Panel>
  );

  return (
    <>
      <PageHeader title={initialActivity === "KUDOS" ? "Kudos" : "Engage"} subtitle={initialActivity === "KUDOS" ? "Recognition from your colleagues" : "What's happening across the company"} />
      <Stack>
        <Panel>
          <div style={{ display: "flex", alignItems: "center", gap: space[4], flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: space[3], flex: "1 1 260px", minWidth: 0 }}>
              <InitialsAvatar name={user?.fullName ?? "?"} size={48} />
              <div style={{ fontSize: isPhone ? fs.lg : fs.xl, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.3 }}>Hey {firstName}, ready to dive in?</div>
            </div>
            <div style={{ display: "flex", gap: space[3], flexWrap: "wrap", flex: "1 1 380px" }}>
              <ActionTile icon={<TrophyOutlined />} label="Give Kudos" hint="Recognise a colleague" onClick={() => setKudosOpen(true)} tone={{ bg: v.chipWarningBg, fg: v.chipWarningText }} />
              <ActionTile icon={<SmileOutlined />} label="Create Poll" hint="Ask the company" onClick={() => setPollOpen(true)} tone={{ bg: v.chipPurpleBg, fg: v.chipPurpleText }} />
            </div>
          </div>
          {!isPhone && <div style={{ marginTop: space[5] }}>{composer}</div>}
        </Panel>

        <div style={{ display: "grid", gridTemplateColumns: isPhone ? "minmax(0, 1fr)" : "minmax(240px, 280px) minmax(0, 1fr)", gap: isPhone ? space[4] : space[6], alignItems: "start" }}>
          {!isPhone && filterPanel}
          <div style={{ minWidth: 0 }}>
            {isPhone && (
              <FilterBar
                onSearch={setSearchText}
                searchValue={searchText}
                searchPlaceholder="Search the feed"
                activeCount={activeCount}
                onClear={clearFilters}
                filters={
                  <>
                    <span style={groupLabel}>Activities</span>
                    {activityRadios}
                    <span style={{ ...groupLabel, marginTop: space[3] }}>Groups, location and department</span>
                    {selects}
                  </>
                }
              />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: space[3], marginBottom: space[4], flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>{feedTitle}</h2>
              <Select aria-label="Sort" defaultValue="newest" style={{ width: 180 }} options={[{ value: "newest", label: "Sort: Newest first" }]} />
            </div>
            {feedList}
            {isPhone && <div style={{ height: 72 }} aria-hidden />}
          </div>
        </div>
      </Stack>

      {isPhone && (
        <Button
          type="primary"
          shape="round"
          size="large"
          icon={<PlusOutlined />}
          onClick={() => setComposerOpen(true)}
          style={{ position: "fixed", right: space[4], bottom: "calc(64px + 16px + env(safe-area-inset-bottom))", zIndex: 20, boxShadow: "0 8px 24px var(--ws-shadow-color)" }}
        >
          Create
        </Button>
      )}

      <SideDrawer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="Create post"
        primaryLabel="Post"
        onPrimary={() => postMutation.mutate()}
        primaryDisabled={!draft.trim()}
        primaryLoading={postMutation.isPending}
        destroyOnHidden={false}
      >
        {composer}
      </SideDrawer>
      <GiveKudosModal open={kudosOpen} onClose={() => setKudosOpen(false)} />
      <CreatePollModal open={pollOpen} onClose={() => setPollOpen(false)} />
    </>
  );
}
