import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { getPerson } from "../../../api/people";
import { EmployeeAvatar } from "../../../components/common/EmployeeAvatar";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { InitialsAvatar, KeyValueGrid, QueryState, SideDrawer, Skel, useIsPhone, type KeyValueItem } from "../../../ui";
// PEEPS-BEGIN badges-nudges
import { PersonBadges } from "../../../features/recognition/PersonBadges";
// PEEPS-END

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatBirthday = (mmdd: string) => `${Number(mmdd.slice(3, 5))} ${MONTHS[Number(mmdd.slice(0, 2)) - 1]}`;

function PersonSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }} aria-busy="true" aria-label="Loading profile">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[2] }}>
        <Skel w={96} h={96} r={radius.pill} />
        <Skel w="50%" h={20} />
        <Skel w="35%" h={14} />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skel key={i} h={18} />
      ))}
    </div>
  );
}

// One colleague's directory card. Which contact fields appear is decided
// server-side (company-wide setting); absent fields are simply not shown.
export function PersonDrawer({ employeeId, onClose, onSelectPerson }: { employeeId: string | null; onClose: () => void; onSelectPerson: (id: string) => void }) {
  const phone = useIsPhone();
  const { data: person, isLoading, error, refetch } = useQuery({
    queryKey: ["people", "person", employeeId],
    queryFn: () => getPerson(employeeId!),
    enabled: Boolean(employeeId),
  });

  const items: KeyValueItem[] = person
    ? [
        { label: "Employee Code", value: person.employeeCode },
        { label: "Department", value: person.department.name },
        { label: "Branch", value: person.location.name },
        ...(person.reportingManager !== undefined
          ? [
              {
                label: "Reports to",
                value: person.reportingManager ? (
                  <Button
                    type="link"
                    onClick={() => onSelectPerson(person.reportingManager!.id)}
                    style={{ padding: 0, height: "auto", minHeight: phone ? 44 : undefined, display: "inline-flex", alignItems: "center", gap: space[2], fontWeight: fw.medium }}
                  >
                    <InitialsAvatar name={person.reportingManager.name} size={24} />
                    {person.reportingManager.name}
                  </Button>
                ) : (
                  "—"
                ),
              },
            ]
          : []),
        ...(person.officialEmail !== undefined ? [{ label: "Official email", value: person.officialEmail ? <a href={`mailto:${person.officialEmail}`}>{person.officialEmail}</a> : "—" }] : []),
        ...(person.mobile !== undefined ? [{ label: "Mobile", value: <a href={`tel:${person.mobile}`}>{person.mobile}</a> }] : []),
        ...(person.personalEmail !== undefined ? [{ label: "Personal email", value: person.personalEmail }] : []),
        ...(person.birthday !== undefined ? [{ label: "Birthday", value: formatBirthday(person.birthday) }] : []),
        ...(person.dateOfJoining !== undefined
          ? [{ label: "Joined", value: new Date(person.dateOfJoining).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) }]
          : []),
      ]
    : [];

  return (
    <SideDrawer open={Boolean(employeeId)} onClose={onClose} title="Profile" footer={null}>
      <QueryState isLoading={isLoading || (!error && !person)} error={error} onRetry={() => void refetch()} skeleton={<PersonSkeleton />} compact>
        {person && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[6] }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[1], textAlign: "center" }}>
              <EmployeeAvatar employeeId={person.id} name={person.name} photoVersion={person.photoVersion} size={96} variant="full" />
              <h3 style={{ margin: `${space[3]}px 0 0`, fontSize: fs.h2, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.3, wordBreak: "break-word" }}>{person.name}</h3>
              <div style={{ color: v.textSecondary, fontSize: fs.md }}>{person.designation.name}</div>
              {(person.officialEmail || person.mobile) && (
                <div style={{ display: "flex", gap: space[2], marginTop: space[3], flexWrap: "wrap", justifyContent: "center" }}>
                  {person.officialEmail && (
                    <Button icon={<MailOutlined />} href={`mailto:${person.officialEmail}`}>
                      Email
                    </Button>
                  )}
                  {person.mobile && (
                    <Button icon={<PhoneOutlined />} href={`tel:${person.mobile}`}>
                      Call
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div style={{ borderTop: `1px solid ${v.borderDefault}`, paddingTop: space[5] }}>
              <KeyValueGrid columns={1} items={items} />
              {/* PEEPS-BEGIN badges-nudges */}
              <PersonBadges employeeId={person.id} />
              {/* PEEPS-END */}
            </div>
          </div>
        )}
      </QueryState>
    </SideDrawer>
  );
}
