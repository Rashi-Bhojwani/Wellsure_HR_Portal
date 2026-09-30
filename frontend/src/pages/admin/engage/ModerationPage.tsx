import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, List, Popconfirm, Segmented, Space, Tag, Typography, message } from "antd";
import * as engageApi from "../../../api/engage";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { EmptyState } from "../../../components/common/EmptyState";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;

const KIND_LABEL: Record<engageApi.PostKind, string> = {
  USER: "Post",
  KUDOS: "Kudos",
  POLL: "Poll",
  AUTO_BIRTHDAY: "Birthday",
  AUTO_JOINING: "New Joiner",
  AUTO_ANNIVERSARY: "Anniversary",
};

export function ModerationPage() {
  const [filter, setFilter] = useState<"visible" | "hidden">("visible");
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["engage", "moderation", filter],
    queryFn: () => engageApi.listPostsForModeration({ moderated: filter === "hidden", pageSize: 50 }),
  });

  const hideMutation = useMutation({
    mutationFn: engageApi.moderatePost,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "moderation"] });
      void message.success("Post hidden from the feed.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not hide this post.")),
  });

  const unhideMutation = useMutation({
    mutationFn: engageApi.unmoderatePost,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["engage", "moderation"] });
      void message.success("Post restored to the feed.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not restore this post.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <HelpStrip storageKey="engage-moderation">
        Hiding a post is a soft action — it disappears from the feed and stops counting toward kudos totals, but is never deleted and can be restored here at any time.
      </HelpStrip>

      <Title level={4} style={{ margin: 0 }}>
        Moderation
      </Title>

      <Segmented options={[{ label: "Visible", value: "visible" }, { label: "Hidden", value: "hidden" }]} value={filter} onChange={(v) => setFilter(v as typeof filter)} />

      <Card loading={isLoading}>
        {data && data.rows.length > 0 ? (
          <List
            dataSource={data.rows}
            renderItem={(post) => (
              <List.Item
                actions={[
                  filter === "visible" ? (
                    <Popconfirm key="hide" title="Hide this post from the feed?" onConfirm={() => hideMutation.mutate(post.id)}>
                      <Button danger size="small" loading={hideMutation.isPending}>
                        Hide
                      </Button>
                    </Popconfirm>
                  ) : (
                    <Button key="unhide" size="small" onClick={() => unhideMutation.mutate(post.id)} loading={unhideMutation.isPending}>
                      Restore
                    </Button>
                  ),
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <Tag color="blue">{KIND_LABEL[post.kind]}</Tag>
                      {post.groupName && <Tag>{post.groupName}</Tag>}
                      <Text type="secondary" style={{ fontSize: 12 }}>{new Date(post.createdAt).toLocaleString()}</Text>
                    </Space>
                  }
                  description={
                    <>
                      <Text strong>{post.authorName ?? post.subjectName ?? "System"}</Text>
                      <br />
                      <Text>{post.kudos?.message ?? post.body}</Text>
                    </>
                  }
                />
              </List.Item>
            )}
          />
        ) : (
          <EmptyState message={filter === "visible" ? "No posts to review" : "No hidden posts"} />
        )}
      </Card>
    </Space>
  );
}
