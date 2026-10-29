import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Segmented } from "antd";
import { EyeInvisibleOutlined, UndoOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as engageApi from "../../../api/engage";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, InitialsAvatar, PageHeader, Panel, Stack, StatusChip, toast } from "../../../ui";

const KIND_LABEL: Record<engageApi.PostKind, string> = {
  USER: "Post",
  KUDOS: "Kudos",
  POLL: "Poll",
  AUTO_BIRTHDAY: "Birthday",
  AUTO_JOINING: "New Joiner",
  AUTO_ANNIVERSARY: "Anniversary",
};

const KIND_TONE: Record<engageApi.PostKind, "info" | "warning" | "purple" | "success"> = {
  USER: "info",
  KUDOS: "warning",
  POLL: "purple",
  AUTO_BIRTHDAY: "success",
  AUTO_JOINING: "success",
  AUTO_ANNIVERSARY: "success",
};

const who = (post: engageApi.PostRow) => post.authorName ?? post.subjectName ?? "System";
const content = (post: engageApi.PostRow) => post.kudos?.message ?? post.body;

export function ModerationPage() {
  const [filter, setFilter] = useState<"visible" | "hidden">("visible");
  const [confirming, setConfirming] = useState<engageApi.PostRow | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["engage", "moderation", filter],
    queryFn: () => engageApi.listPostsForModeration({ moderated: filter === "hidden", pageSize: 50 }),
    placeholderData: keepPreviousData,
  });

  const hideMutation = useMutation({
    mutationFn: engageApi.moderatePost,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "moderation"] });
      toast.success("Post hidden from the feed.");
      setConfirming(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not hide this post.")),
  });

  const unhideMutation = useMutation({
    mutationFn: engageApi.unmoderatePost,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "moderation"] });
      toast.success("Post restored to the feed.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not restore this post.")),
  });

  const action = (post: engageApi.PostRow) =>
    filter === "visible" ? (
      <Button danger icon={<EyeInvisibleOutlined />} onClick={() => setConfirming(post)}>
        Hide
      </Button>
    ) : (
      <Button icon={<UndoOutlined />} onClick={() => unhideMutation.mutate(post.id)} loading={unhideMutation.isPending && unhideMutation.variables === post.id}>
        Restore
      </Button>
    );

  const rows = data?.rows ?? [];

  return (
    <>
      <PageHeader title="Moderation" subtitle="Hide or restore posts in the Engage feed" />
      <Stack>
        <HelpStrip storageKey="engage-moderation">
          Hiding a post is a soft action — it disappears from the feed and stops counting toward kudos totals, but is never deleted and can be restored here at any time.
        </HelpStrip>

        <Panel
          title={filter === "visible" ? "Visible posts" : "Hidden posts"}
          extra={<Segmented options={[{ label: "Visible", value: "visible" }, { label: "Hidden", value: "hidden" }]} value={filter} onChange={(val) => setFilter(val as typeof filter)} />}
        >
          <DataTable<engageApi.PostRow>
            rowKey="id"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={rows}
            pagination={false}
            empty={<EmptyState compact illustration="inbox" title={filter === "visible" ? "No posts to review" : "No hidden posts"} description={null} />}
            columns={[
              {
                title: "Author",
                key: "author",
                width: 220,
                render: (_, post) => (
                  <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
                    <InitialsAvatar name={who(post)} size={32} />
                    <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{who(post)}</span>
                  </div>
                ),
              },
              {
                title: "Post",
                key: "content",
                render: (_, post) => <div style={{ maxWidth: 480, whiteSpace: "normal", color: v.textBody, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{content(post)}</div>,
              },
              { title: "Type", key: "kind", render: (_, post) => <StatusChip tone={KIND_TONE[post.kind]}>{KIND_LABEL[post.kind]}</StatusChip> },
              { title: "Group", key: "group", render: (_, post) => post.groupName ?? "—" },
              { title: "Posted", key: "createdAt", render: (_, post) => <span style={{ whiteSpace: "nowrap" }}>{dayjs(post.createdAt).format("DD MMM YYYY, HH:mm")}</span> },
              { title: "", key: "actions", align: "right", render: (_, post) => action(post) },
            ]}
            mobile={{
              avatar: (post) => <InitialsAvatar name={who(post)} size={36} />,
              title: (post) => who(post),
              subtitle: (post) => dayjs(post.createdAt).format("DD MMM YYYY, HH:mm"),
              status: (post) => <StatusChip tone={KIND_TONE[post.kind]}>{KIND_LABEL[post.kind]}</StatusChip>,
              fields: [
                { label: "Post", render: (post) => <span style={{ fontSize: fs.table }}>{content(post)}</span> },
                { label: "Group", render: (post) => post.groupName ?? "—" },
              ],
              actions: (post) => <div style={{ width: "100%", display: "grid" }}>{action(post)}</div>,
            }}
          />
        </Panel>
      </Stack>

      <ConfirmModal
        open={confirming !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && hideMutation.mutate(confirming.id)}
        loading={hideMutation.isPending}
        danger
        title="Hide this post from the feed?"
        info="It is never deleted and can be restored from the Hidden tab."
        confirmLabel="Hide"
      />
    </>
  );
}
