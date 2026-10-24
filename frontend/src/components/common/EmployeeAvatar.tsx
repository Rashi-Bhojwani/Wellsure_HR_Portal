import { Avatar, type AvatarProps } from "antd";
import { photoUrl } from "../../api/people";
import { usePhotoToken } from "../../hooks/usePhotoToken";
import { InitialsAvatar } from "../../ui/Avatar";

interface EmployeeAvatarProps {
  employeeId: string;
  name: string;
  photoVersion: string | null | undefined;
  size?: AvatarProps["size"];
  // "thumb" (96px) for lists/cards/org chart; "full" (512px) for a detail view.
  variant?: "thumb" | "full";
}

// An employee's photo, or their initials when there isn't one. Images load
// lazily, so a long directory page only fetches thumbnails as they scroll in.
export function EmployeeAvatar({ employeeId, name, photoVersion, size = 40, variant = "thumb" }: EmployeeAvatarProps) {
  const token = usePhotoToken(Boolean(photoVersion));
  const src = photoVersion && token ? photoUrl(employeeId, photoVersion, variant, token) : undefined;
  if (!src) return <InitialsAvatar name={name} size={typeof size === "number" ? size : 40} />;
  return <Avatar size={size} src={<img src={src} alt={name} loading="lazy" decoding="async" />} style={{ flexShrink: 0 }} />;
}
