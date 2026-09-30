import { useQuery } from "@tanstack/react-query";
import { Descriptions, Drawer, Space, Typography } from "antd";
import { getPerson } from "../../../api/people";
import { EmployeeAvatar } from "../../../components/common/EmployeeAvatar";
import { EmptyState } from "../../../components/common/EmptyState";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const formatBirthday = (mmdd: string) => `${Number(mmdd.slice(3, 5))} ${MONTHS[Number(mmdd.slice(0, 2)) - 1]}`;

// One colleague's directory card. Which contact fields appear is decided
// server-side (company-wide setting); absent fields are simply not shown.
export function PersonDrawer({ employeeId, onClose, onSelectPerson }: { employeeId: string | null; onClose: () => void; onSelectPerson: (id: string) => void }) {
  const { data: person, isLoading } = useQuery({
    queryKey: ["people", "person", employeeId],
    queryFn: () => getPerson(employeeId!),
    enabled: Boolean(employeeId),
  });

  return (
    <Drawer open={Boolean(employeeId)} onClose={onClose} title="Profile" size="default">
      {isLoading || !person ? (
        <EmptyState message="Loading…" />
      ) : (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Space size={16} align="center">
            <EmployeeAvatar employeeId={person.id} name={person.name} photoVersion={person.photoVersion} size={96} variant="full" />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                {person.name}
              </Typography.Title>
              <Typography.Text type="secondary">{person.designation.name}</Typography.Text>
            </div>
          </Space>
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="Employee Code">{person.employeeCode}</Descriptions.Item>
            <Descriptions.Item label="Department">{person.department.name}</Descriptions.Item>
            <Descriptions.Item label="Branch">{person.location.name}</Descriptions.Item>
            {person.reportingManager !== undefined && (
              <Descriptions.Item label="Reports to">
                {person.reportingManager ? (
                  <Typography.Link onClick={() => onSelectPerson(person.reportingManager!.id)}>{person.reportingManager.name}</Typography.Link>
                ) : (
                  "—"
                )}
              </Descriptions.Item>
            )}
            {person.officialEmail !== undefined && (
              <Descriptions.Item label="Official email">
                {person.officialEmail ? <a href={`mailto:${person.officialEmail}`}>{person.officialEmail}</a> : "—"}
              </Descriptions.Item>
            )}
            {person.mobile !== undefined && (
              <Descriptions.Item label="Mobile">
                <a href={`tel:${person.mobile}`}>{person.mobile}</a>
              </Descriptions.Item>
            )}
            {person.personalEmail !== undefined && <Descriptions.Item label="Personal email">{person.personalEmail}</Descriptions.Item>}
            {person.birthday !== undefined && <Descriptions.Item label="Birthday">{formatBirthday(person.birthday)}</Descriptions.Item>}
            {person.dateOfJoining !== undefined && <Descriptions.Item label="Joined">{new Date(person.dateOfJoining).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Descriptions.Item>}
          </Descriptions>
        </Space>
      )}
    </Drawer>
  );
}
