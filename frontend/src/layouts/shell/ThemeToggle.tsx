import { Segmented } from "antd";
import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { useThemeMode, type ThemePreference } from "../../theme/ThemeProvider";

// The board's Light / Dark pill toggle at the bottom of the sidebar, plus "System" (DESIGN_SYSTEM.md §10 D9). Saved per viewer.
export function ThemeToggle({ block = true, iconsOnly = false }: { block?: boolean; iconsOnly?: boolean }) {
  const { preference, setPreference } = useThemeMode();
  const opt = (value: ThemePreference, label: string, icon: React.ReactNode) => ({
    value,
    label: iconsOnly ? <span aria-label={label}>{icon}</span> : (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {icon}
        {label}
      </span>
    ),
    title: label,
  });
  return (
    <Segmented<ThemePreference>
      aria-label="Theme"
      block={block}
      value={preference}
      onChange={setPreference}
      options={[opt("light", "Light", <SunOutlined />), opt("dark", "Dark", <MoonOutlined />), opt("system", "Auto", <DesktopOutlined />)]}
    />
  );
}
