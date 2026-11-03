import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Space } from "antd";
import { FontSizeOutlined, GiftOutlined, UploadOutlined } from "@ant-design/icons";
import * as peopleApi from "../../api/people";
import { apiErrorMessage } from "../../lib/apiError";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { ApprovalBanner, QueryState, SideDrawer, Skel, toast } from "../../ui";
import { chooseAvatar, getCatalogue, surpriseAvatar, type AvatarView } from "./api";
import { AVATAR_BASE } from "./useAvatarMap";

// Change avatar (D-35), from My profile → Your photo. Upload a photo (the existing photo rules: re-encoded, metadata dropped), use your initials,
// "Surprise me" (one random character per tap), or pick one of the 24 characters or 26 fun picks. Only ever your own avatar. A character or fun pick
// needs no moderation; HR and the directors can still remove an inappropriate photo.

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function Grid({ title, items, current, onPick, busy }: { title: string; items: Array<{ id: string; name: string; file: string }>; current: AvatarView | null; onPick: (id: string) => void; busy: boolean }) {
  return (
    <section aria-label={title} style={{ marginTop: space[5] }}>
      <h3 style={{ margin: `0 0 ${space[3]}px`, fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary }}>{title}</h3>
      <div role="list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: space[3] }}>
        {items.map((item) => {
          const selected = current?.catalogueId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="listitem"
              aria-label={item.name}
              aria-pressed={selected}
              disabled={busy}
              onClick={() => onPick(item.id)}
              style={{
                minWidth: 44,
                minHeight: 44,
                padding: space[1],
                background: selected ? v.accentSubtle : v.bgSurface,
                border: `2px solid ${selected ? v.accent : v.borderDefault}`,
                borderRadius: radius.pill,
                cursor: busy ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img src={`${AVATAR_BASE}${item.file}`} alt="" width={52} height={52} loading="lazy" decoding="async" style={{ borderRadius: radius.pill }} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ChangeAvatarDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: AvatarView | null }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const catalogue = useQuery({ queryKey: ["avatars", "catalogue"], queryFn: getCatalogue, staleTime: Infinity, enabled: open });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["avatars"] });
    void queryClient.invalidateQueries({ queryKey: ["profile", "me"] });
    void queryClient.invalidateQueries({ queryKey: ["me"] });
  };
  const choose = useMutation({
    mutationFn: chooseAvatar,
    onSuccess: () => {
      refresh();
      toast.success("Avatar changed.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't change your avatar.")),
  });
  const surprise = useMutation({
    mutationFn: () => surpriseAvatar(newKey()), // a new key per tap: one tap, one choice
    onSuccess: () => {
      refresh();
      toast.success("Surprise! Your new avatar is set.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't pick a surprise.")),
  });
  const upload = async (file: File) => {
    setBusy(true);
    try {
      await peopleApi.uploadMyPhoto(file);
      await chooseAvatar({ kind: "PHOTO" });
      refresh();
      toast.success("Photo uploaded. Location and camera details were removed.");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't upload the photo."));
    } finally {
      setBusy(false);
    }
  };
  const working = busy || choose.isPending || surprise.isPending;

  return (
    <SideDrawer open={open} onClose={onClose} title="Change avatar" subtitle="Choose how you appear everywhere in the portal. Only you can change it." footer={null} size="wide">
      <Space wrap size={space[3]}>
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        <Button icon={<UploadOutlined />} loading={busy} onClick={() => input.current?.click()}>
          Upload a photo
        </Button>
        <Button icon={<FontSizeOutlined />} disabled={working} aria-pressed={current?.kind === "INITIALS"} onClick={() => choose.mutate({ kind: "INITIALS" })}>
          Use my initials
        </Button>
        <Button icon={<GiftOutlined />} loading={surprise.isPending} disabled={working && !surprise.isPending} onClick={() => surprise.mutate()}>
          Surprise me
        </Button>
      </Space>
      <QueryState
        isLoading={catalogue.isLoading}
        error={catalogue.error}
        onRetry={() => void catalogue.refetch()}
        skeleton={<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: space[3], marginTop: space[5] }}>{Array.from({ length: 12 }, (_, i) => <Skel key={i} w={56} h={56} r={radius.pill} />)}</div>}
      >
        {catalogue.data && (
          <>
            {catalogue.data.placeholder && <div style={{ marginTop: space[4] }}><ApprovalBanner tone="info" title="Placeholder artwork" description="These are simple placeholder pictures until the company's own artwork is added." /></div>}
            <Grid title="Characters" items={catalogue.data.characters} current={current?.kind === "CHARACTER" ? current : null} busy={working} onPick={(id) => choose.mutate({ kind: "CHARACTER", catalogueId: id })} />
            <Grid title="Fun picks" items={catalogue.data.fun} current={current?.kind === "FUN" ? current : null} busy={working} onPick={(id) => choose.mutate({ kind: "FUN", catalogueId: id })} />
          </>
        )}
      </QueryState>
    </SideDrawer>
  );
}
