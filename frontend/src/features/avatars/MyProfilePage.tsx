import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { EditOutlined, TrophyOutlined } from "@ant-design/icons";
import { EmployeeAvatar } from "../../components/common/EmployeeAvatar";
import { formatDate } from "../../lib/dates";
import { fs, fw, space, v } from "../../theme/tokens";
import { CardGrid, EmptyState, PageHeader, Panel, QueryState, SkeletonCard, Stack, StatusChip, useIsPhone } from "../../ui";
import { getMyProfile, type MyProfile } from "./api";
import { ChangeAvatarDialog } from "./ChangeAvatarDialog";

// My profile (D-35): your role, department, grade, code, joining date and tenure, who you report to, your direct reports, your badges, your assets and
// your own contact details. Your photo → Change avatar opens the avatar dialog. Someone else's profile is their directory card (only the fields the
// directory setting allows, plus badges); pay, bank, statutory, medical and private Peeps data are never on a profile.

function Rows({ items }: { items: Array<[string, string | null | undefined]> }) {
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(110px, auto) 1fr", gap: `${space[2]}px ${space[4]}px` }}>
      {items.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt style={{ color: v.textSecondary, fontSize: fs.sm }}>{label}</dt>
          <dd style={{ margin: 0, color: v.textPrimary }}>{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

const tenureText = (t: MyProfile["tenure"]) => [t.years ? `${t.years} year${t.years === 1 ? "" : "s"}` : null, `${t.months} month${t.months === 1 ? "" : "s"}`].filter(Boolean).join(", ");

export function MyProfilePage() {
  const phone = useIsPhone();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["profile", "me"], queryFn: getMyProfile });
  const [changing, setChanging] = useState(false);
  return (
    <>
      <PageHeader title="My profile" subtitle="How you appear to colleagues, and your own details" />
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<CardGrid min={300}>{[0, 1, 2, 3].map((i) => <SkeletonCard key={i} lines={4} />)}</CardGrid>}>
        {data && (
          <Stack>
            <Panel title="Your photo">
              <div style={{ display: "flex", flexDirection: phone ? "column" : "row", alignItems: "center", gap: space[5] }}>
                <EmployeeAvatar employeeId={data.employeeId} name={data.name} photoVersion={data.avatar.kind === "PHOTO" ? data.photoVersion : null} size={96} variant="full" />
                <div style={{ display: "flex", flexDirection: "column", alignItems: phone ? "center" : "flex-start", gap: space[2] }}>
                  <span style={{ fontSize: fs.h2, fontWeight: fw.bold, color: v.textPrimary }}>{data.name}</span>
                  <span style={{ color: v.textSecondary }}>{[data.role, data.department].filter(Boolean).join(" · ")}</span>
                  <Button icon={<EditOutlined />} onClick={() => setChanging(true)}>
                    Change avatar
                  </Button>
                </div>
              </div>
            </Panel>
            <CardGrid min={300}>
              <Panel title="Work">
                <Rows
                  items={[
                    ["Role", data.role],
                    ["Department", data.department],
                    ["Grade", data.grade],
                    ["Office", data.location],
                    ["Employee code", data.employeeCode],
                    ["Joined", formatDate(data.dateOfJoining)],
                    ["Tenure", tenureText(data.tenure)],
                    ["Reports to", data.reportsTo ? `${data.reportsTo.name} (${data.reportsTo.employeeCode})` : null],
                  ]}
                />
              </Panel>
              <Panel title="Your contact details" subtitle="Yours to see; colleagues see only what the directory shows">
                <Rows items={[["Work email", data.personal.workEmail], ["Phone", data.personal.phone], ["Birthday", data.personal.birthday ? formatDate(data.personal.birthday) : null]]} />
              </Panel>
              <Panel title="Direct reports">
                {data.directReports.length === 0 ? (
                  <EmptyState compact illustration={false} title="Nobody reports to you" description={null} />
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[3] }}>
                    {data.directReports.map((r) => (
                      <li key={r.employeeId} style={{ display: "flex", alignItems: "center", gap: space[3] }}>
                        <EmployeeAvatar employeeId={r.employeeId} name={r.name} size={36} />
                        <span style={{ display: "flex", flexDirection: "column" }}>
                          <span style={{ color: v.textPrimary, fontWeight: fw.medium }}>{r.name}</span>
                          <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{[r.role, r.employeeCode].filter(Boolean).join(" · ")}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Your badges">
                {data.badges.length === 0 ? (
                  <EmptyState compact illustration={false} title="No badges yet" description={null} />
                ) : (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", gap: space[2] }}>
                    {data.badges.map((b) => (
                      <li key={b.id}>
                        <StatusChip tone="success">
                          <TrophyOutlined aria-hidden /> {b.badge}
                        </StatusChip>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Your assets">
                {data.assets.length === 0 ? (
                  <EmptyState compact illustration={false} title="No assets issued to you" description={null} />
                ) : (
                  <Rows items={data.assets.map((a) => [a.assetId, `${a.name} · ${a.category} · since ${formatDate(a.issuedAt)}`])} />
                )}
              </Panel>
            </CardGrid>
          </Stack>
        )}
      </QueryState>
      <ChangeAvatarDialog open={changing} onClose={() => setChanging(false)} current={data?.avatar ?? null} />
    </>
  );
}
