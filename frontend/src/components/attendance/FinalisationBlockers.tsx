import { Button } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import type { FinalisationBlocker, FinalisationReadiness, FinalisationWarning } from "../../api/attendance";
import { fs, space, v } from "../../theme/tokens";
import { ApprovalBanner } from "../../ui";
const ATTENDANCE = "/admin/workforce/attendance";

const BLOCKER_TITLES: Record<FinalisationBlocker["code"], string> = {
  PLACEHOLDER_RULES: "Rule values are still placeholders",
  NOT_MARKED: "Days not marked",
  NO_SHIFT: "Days with no shift",
  NOT_UP_TO_DATE: "Days not up to date with the rules and data",
  FLAGGED_PUNCHES: "Punches with an implausible time are waiting for a decision",
  PENDING_REGULARIZATIONS: "Correction requests are waiting for a decision",
  PERIOD_NOT_OVER: "The period hasn't ended",
};

/** Where to go to deal with each reason: the screen that fixes it, narrowed to the period where that is possible. */
function linkFor(code: FinalisationBlocker["code"], from: string, to: string): { to: string; label: string } | null {
  switch (code) {
    case "PLACEHOLDER_RULES":
      return { to: `${ATTENDANCE}/settings`, label: "Confirm the values in Attendance Settings" };
    case "NOT_MARKED":
      return { to: `${ATTENDANCE}/muster`, label: "Open the Attendance Muster" };
    case "NO_SHIFT":
      return { to: `${ATTENDANCE}/exceptions?type=NO_SHIFT&from=${from}&to=${to}`, label: "Resolve in the Exceptions queue" };
    case "NOT_UP_TO_DATE":
      return { to: `${ATTENDANCE}/process`, label: "Process Attendance for the period" };
    case "FLAGGED_PUNCHES":
      return { to: "/admin/admin-tools/devices?tab=flagged", label: "Decide them on Devices → Flagged" };
    case "PENDING_REGULARIZATIONS":
      return { to: `${ATTENDANCE}/regularizations`, label: "Open Regularizations" };
    default:
      return null;
  }
}

function sample(b: FinalisationBlocker): string | null {
  if ("days" in b && b.days.length > 0) return `${b.days.slice(0, 8).map((d) => `${d.employeeName} (${d.date})`).join(", ")}${b.count > 8 ? `, and ${b.count - 8} more` : ""}`;
  if (b.code === "FLAGGED_PUNCHES" && b.punches.length > 0) return `${b.punches.slice(0, 8).map((p) => `${p.employeeName ?? `device ID ${p.deviceUserId}`} (${p.date})`).join(", ")}${b.count > 8 ? `, and ${b.count - 8} more` : ""}`;
  return null;
}

function warningLink(w: FinalisationWarning, from: string, to: string): { to: string; label: string } {
  return { to: `${ATTENDANCE}/exceptions?type=UNMAPPED_ID&from=${from}&to=${to}`, label: "See the unmapped device IDs" };
}

/** Every blocker grouped by reason with its count and a link to where it is fixed, then the warnings that do not block. */
export function FinalisationBlockers({ readiness }: { readiness: FinalisationReadiness }) {
  const navigate = useNavigate();
  const { from, to } = readiness;
  const go = (link: { to: string; label: string }) => (
    <Button onClick={() => navigate(link.to)} icon={<ArrowRightOutlined />} iconPlacement="end">
      {link.label}
    </Button>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[3], width: "100%" }}>
      {readiness.blockers.map((b) => {
        const link = linkFor(b.code, from, to);
        const eg = sample(b);
        return (
          <ApprovalBanner
            key={b.code}
            tone={b.code === "PLACEHOLDER_RULES" ? "danger" : "warning"}
            title={`${BLOCKER_TITLES[b.code]}${"count" in b ? ` (${b.count})` : ""}`}
            description={
              <>
                <div>{b.message}</div>
                {eg && <div style={{ fontSize: fs.sm, color: v.textSecondary, marginTop: space[1] }}>{eg}</div>}
              </>
            }
            actions={link ? go(link) : undefined}
          />
        );
      })}
      {readiness.warnings.map((w) => {
        const link = warningLink(w, from, to);
        return <ApprovalBanner key={w.code} tone="info" title={`Does not block: ${w.count} punch${w.count === 1 ? "" : "es"} matched to nobody`} description={w.message} actions={go(link)} />;
      })}
    </div>
  );
}
