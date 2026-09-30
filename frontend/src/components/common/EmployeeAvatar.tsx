import { Avatar, type AvatarProps } from "antd";
import { photoUrl } from "../../api/people";
import { usePhotoToken } from "../../hooks/usePhotoToken";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

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
  return (
    <Avatar
      size={size}
      src={src ? <img src={src} alt={name} loading="lazy" decoding="async" /> : undefined}
      style={src ? undefined : { backgroundColor: "#1677ff", flexShrink: 0 }}
    >
      {initials(name)}
    </Avatar>
  );
}
