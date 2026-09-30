import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, Col, Empty, Input, Pagination, Row, Select, Space, Tabs, Typography } from "antd";
import { MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import * as orgApi from "../../../api/org";
import { listDirectory } from "../../../api/people";
import { EmployeeAvatar } from "../../../components/common/EmployeeAvatar";
import { EmptyState } from "../../../components/common/EmptyState";
import { OrgChart } from "./OrgChart";
import { PersonDrawer } from "./PersonDrawer";

const PAGE_SIZE = 24;
const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function Directory({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string>();
  const [locationId, setLocationId] = useState<string>();
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search, 300);

  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data, isLoading } = useQuery({
    queryKey: ["people", "directory", debouncedSearch, departmentId, locationId, page],
    queryFn: () => listDirectory({ search: debouncedSearch || undefined, departmentId, locationId, page, pageSize: PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[12, 12]}>
        <Col xs={24} md={10}>
          <Input.Search
            allowClear
            placeholder="Search by name or employee code"
            aria-label="Search people"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </Col>
        <Col xs={12} md={7}>
          <Select
            allowClear
            showSearch={{ optionFilterProp: "label" }}
            placeholder="All departments"
            aria-label="Filter by department"
            style={{ width: "100%" }}
            value={departmentId}
            onChange={(v) => {
              setDepartmentId(v);
              setPage(1);
            }}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
        </Col>
        <Col xs={12} md={7}>
          <Select
            allowClear
            showSearch={{ optionFilterProp: "label" }}
            placeholder="All branches"
            aria-label="Filter by branch"
            style={{ width: "100%" }}
            value={locationId}
            onChange={(v) => {
              setLocationId(v);
              setPage(1);
            }}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
          />
        </Col>
      </Row>

      {isLoading || !data ? (
        <EmptyState message="Loading…" />
      ) : data.items.length === 0 ? (
        <Empty description="No one matches these filters." />
      ) : (
        <>
          <Typography.Text type="secondary">{data.total} {data.total === 1 ? "person" : "people"}</Typography.Text>
          <Row gutter={[12, 12]}>
            {data.items.map((person) => (
              <Col key={person.id} xs={24} sm={12} lg={8} xxl={6}>
                <Card hoverable size="small" onClick={() => onOpenPerson(person.id)} style={{ height: "100%" }}>
                  <Space align="start" size={12} style={{ width: "100%" }}>
                    <EmployeeAvatar employeeId={person.id} name={person.name} photoVersion={person.photoVersion} size={56} />
                    {/* CSS ellipsis, not Typography's measured ellipsis: a page of cards
                        with several measured ellipses each was the directory's main render cost. */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, ...ellipsis }}>{person.name}</div>
                      <div style={{ fontSize: 12, ...ellipsis }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {person.designation.name} · {person.department.name}
                        </Typography.Text>
                      </div>
                      <div style={{ fontSize: 12, ...ellipsis }}>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {person.location.name} · {person.employeeCode}
                        </Typography.Text>
                      </div>
                      {person.officialEmail && (
                        <div style={{ fontSize: 12, ...ellipsis }}>
                          <MailOutlined /> {person.officialEmail}
                        </div>
                      )}
                      {person.mobile && (
                        <div style={{ fontSize: 12 }}>
                          <PhoneOutlined /> {person.mobile}
                        </div>
                      )}
                    </div>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
          <Pagination current={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} showSizeChanger={false} align="center" />
        </>
      )}
    </Space>
  );
}

// People (spec §6): the colleague directory and the org chart.
export function PeoplePage() {
  const [params, setParams] = useSearchParams();
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const tab = params.get("tab") === "org-chart" ? "org-chart" : "directory";

  return (
    <Card>
      <Tabs
        activeKey={tab}
        onChange={(key) => setParams(key === "directory" ? {} : { tab: key }, { replace: true })}
        items={[
          { key: "directory", label: "Directory", children: <Directory onOpenPerson={setOpenPersonId} /> },
          { key: "org-chart", label: "Org Chart", children: <OrgChart onOpenPerson={setOpenPersonId} /> },
        ]}
      />
      <PersonDrawer employeeId={openPersonId} onClose={() => setOpenPersonId(null)} onSelectPerson={setOpenPersonId} />
    </Card>
  );
}
