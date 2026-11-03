import { useState } from "react";
import { Avatar, type AvatarProps } from "antd";
import { photoUrl } from "../../api/people";
import { usePhotoToken } from "../../hooks/usePhotoToken";
import { InitialsAvatar } from "../../ui/Avatar";
// PEEPS-BEGIN avatar-choices
import { AVATAR_BASE, useAvatarMap } from "../../features/avatars/useAvatarMap";
// PEEPS-END

interface EmployeeAvatarProps {
  /** Optional: without it (a row that carries only a name) the avatar is the person's initials. */
  employeeId?: string | null;
  name: string;
  /** Optional: when not given, the avatar map supplies it. */
  photoVersion?: string | null;
  size?: AvatarProps["size"];
  // "thumb" (96px) for lists/cards/org chart; "full" (512px) for a detail view.
  variant?: "thumb" | "full";
}

// The one shared avatar (D-35): the person's chosen character or fun pick, their photo, or their initials — whichever they chose, falling back to
// initials when there is nothing to show or the art is missing. Images load lazily, so a long directory page only fetches as they scroll in. It only
// ever shows what signed-in staff may already see (a photo needs the photo-only token).
export function EmployeeAvatar({ employeeId, name, photoVersion, size = 40, variant = "thumb" }: EmployeeAvatarProps) {
  // PEEPS-BEGIN avatar-choices
  const { data: map } = useAvatarMap();
  const choice = employeeId ? map?.[employeeId] : undefined;
  const version = photoVersion ?? choice?.photoVersion ?? null;
  // PEEPS-END
  const token = usePhotoToken(Boolean(version));
  const [broken, setBroken] = useState(false); // an image that fails to load (missing art, an old photo) shows initials instead
  const px = typeof size === "number" ? size : 40;
  // PEEPS-BEGIN avatar-choices
  if (broken) return <InitialsAvatar name={name} size={px} />;
  if (choice?.file && (choice.kind === "CHARACTER" || choice.kind === "FUN")) {
    return <Avatar size={size} src={<img src={`${AVATAR_BASE}${choice.file}`} alt={name} loading="lazy" decoding="async" onError={() => setBroken(true)} />} style={{ flexShrink: 0 }} />;
  }
  if (choice?.kind === "INITIALS") return <InitialsAvatar name={name} size={px} />;
  // PEEPS-END
  const src = employeeId && version && token ? photoUrl(employeeId, version, variant, token) : undefined;
  if (!src) return <InitialsAvatar name={name} size={px} />;
  return <Avatar size={size} src={<img src={src} alt={name} loading="lazy" decoding="async" onError={() => setBroken(true)} />} style={{ flexShrink: 0 }} />;
}
