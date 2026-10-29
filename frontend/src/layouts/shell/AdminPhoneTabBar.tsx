import { useLocation, useNavigate } from "react-router-dom";
import { CheckSquareOutlined, HomeOutlined, ScheduleOutlined, TeamOutlined } from "@ant-design/icons";

const TABS = [
  { key: "home", label: "Home", path: "/admin", icon: <HomeOutlined />, match: (p: string) => p === "/admin" || p === "/admin/" },
  { key: "tasks", label: "Tasks", path: "/admin/tasks", icon: <CheckSquareOutlined />, match: (p: string) => p.startsWith("/admin/tasks") },
  { key: "people", label: "People", path: "/admin/employee/all", icon: <TeamOutlined />, match: (p: string) => p.startsWith("/admin/employee") },
  { key: "workforce", label: "Workforce", path: "/admin/workforce", icon: <ScheduleOutlined />, match: (p: string) => p.startsWith("/admin/workforce") },
];

// Phones in the admin portal (DESIGN_SYSTEM.md §5, D14): the four most-used areas as tabs; everything else is in the menu (hamburger) and in search.
export function AdminPhoneTabBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <nav aria-label="Main" className="ws-tabbar">
      {TABS.map((t) => (
        <button key={t.key} type="button" className="ws-tabbar__tab" aria-current={t.match(pathname) ? "page" : undefined} onClick={() => navigate(t.path)}>
          <span className="ws-tabbar__icon" aria-hidden>
            {t.icon}
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}
