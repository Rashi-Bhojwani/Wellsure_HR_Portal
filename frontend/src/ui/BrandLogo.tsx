import { useState, type ReactNode } from "react";

// The Wellsure logo (a yellow disc with a black "W" on a white ring), served from frontend/public/logo.png — the repo owner supplies the file; we never draw
// or redraw it. Until the file is there (or if it fails to load) the image is left out and `fallback` (plain text) is shown instead.
export const LOGO_SRC = "/logo.png";

// Remember a failed load for the whole session, so every later mount shows the fallback at once instead of flashing a broken image.
let logoFailed = false;

export function BrandLogo({ size, fallback = null }: { size: number; fallback?: ReactNode }) {
  const [failed, setFailed] = useState(logoFailed);
  if (failed) return <>{fallback}</>;
  return (
    <img
      src={LOGO_SRC}
      alt=""
      aria-hidden
      width={size}
      height={size}
      decoding="async"
      style={{ width: size, height: size, flex: "none", objectFit: "contain", display: "block" }}
      onError={() => {
        logoFailed = true;
        setFailed(true);
      }}
    />
  );
}
