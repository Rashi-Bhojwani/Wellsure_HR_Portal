import { memo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Pagination, Select, Tabs } from "antd";
import { MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import * as orgApi from "../../../api/org";
import { listDirectory, type DirectoryEntry } from "../../../api/people";
import { EmployeeAvatar } from "../../../components/common/EmployeeAvatar";
// PEEPS-BEGIN avatars
import { BadgeCount } from "../../../features/recognition/BadgeCount";
// PEEPS-END
import { OrgChart } from "./OrgChart";
import { PersonDrawer } from "./PersonDrawer";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { CardGrid, EmptyState, FilterBar, PageHeader, Panel, QueryState, Skel, useIsPhone } from "../../../ui";

const PAGE_SIZE = 24;
const REFERENCE_STALE = 5 * 60_000;
const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

// The board's directory card (employees-12): photo, name, designation, a divider, then contact rows. A real <button>, so it opens by keyboard too.
// CSS ellipsis, not Typography's measured ellipsis: a page of cards with several measured ellipses each was the directory's main render cost.
const PersonCard = memo(function PersonCard({ person, onOpen }: { person: DirectoryEntry; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(person.id)}
      aria-label={`${person.name}, ${person.designation.name}, ${person.department.name}`}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: space[1],
        width: "100%",
        height: "100%",
        minWidth: 0,
        padding: `${space[5]}px ${space[4]}px`,
        background: v.bgSurface,
        border: `1px solid ${v.borderDefault}`,
        borderRadius: radius.lg,
        cursor: "pointer",
        font: "inherit",
        color: "inherit",
        textAlign: "center",
      }}
    >
      <EmployeeAvatar employeeId={person.id} name={person.name} photoVersion={person.photoVersion} size={56} />
      <span style={{ display: "block", maxWidth: "100%", marginTop: space[2], fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, ...ellipsis }}>{person.name}</span>
      <span style={{ display: "block", maxWidth: "100%", fontSize: fs.sm, color: v.textSecondary, ...ellipsis }}>
        {person.designation.name} · {person.department.name}
      </span>
      <span style={{ display: "block", maxWidth: "100%", fontSize: fs.sm, color: v.textSecondary, ...ellipsis }}>
        {person.location.name} · {person.employeeCode}
      </span>
      {/* PEEPS-BEGIN avatars */}
      <BadgeCount employeeId={person.id} />
      {/* PEEPS-END */}
      {(person.officialEmail || person.mobile) && (
        <span style={{ display: "flex", flexDirection: "column", gap: space[1], alignItems: "center", width: "100%", marginTop: space[3], paddingTop: space[3], borderTop: `1px solid ${v.borderDefault}` }}>
          {person.officialEmail && (
            <span style={{ display: "flex", alignItems: "center", gap: space[2], maxWidth: "100%", fontSize: fs.sm, color: v.textBody }}>
              <MailOutlined aria-hidden style={{ color: v.textSecondary, flex: "none" }} />
              <span style={ellipsis}>{person.officialEmail}</span>
            </span>
          )}
          {person.mobile && (
            <span style={{ display: "flex", alignItems: "center", gap: space[2], fontSize: fs.sm, color: v.textBody, fontWeight: fw.medium }}>
              <PhoneOutlined aria-hidden style={{ color: v.textSecondary }} />
              <span className="ws-num">{person.mobile}</span>
            </span>
          )}
        </span>
      )}
    </button>
  );
});

function DirectorySkeleton() {
  return (
    <CardGrid min={220} gap={space[4]}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5], display: "flex", flexDirection: "column", alignItems: "center", gap: space[2] }}>
          <Skel w={56} h={56} r={radius.pill} />
          <Skel w="70%" h={16} />
          <Skel w="55%" h={12} />
          <Skel w="80%" h={12} style={{ marginTop: space[3] }} />
        </div>
      ))}
    </CardGrid>
  );
}

function Directory({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const phone = useIsPhone();
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string>();
  const [locationId, setLocationId] = useState<string>();
  const [page, setPage] = useState(1);

  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, staleTime: REFERENCE_STALE });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), staleTime: REFERENCE_STALE });
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["people", "directory", search, departmentId, locationId, page],
    queryFn: () => listDirectory({ search: search || undefined, departmentId, locationId, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const activeCount = (departmentId ? 1 : 0) + (locationId ? 1 : 0);
  const clearAll = () => {
    setDepartmentId(undefined);
    setLocationId(undefined);
    setPage(1);
  };

  return (
    <div style={{ paddingTop: space[2] }}>
      <FilterBar
        onSearch={(s) => {
          setSearch(s);
          setPage(1);
        }}
        searchValue={search}
        searchPlaceholder="Search by name or employee code"
        activeCount={activeCount}
        onClear={clearAll}
        filters={
          <>
            <Select
              allowClear
              showSearch={{ optionFilterProp: "label" }}
              placeholder="All departments"
              aria-label="Filter by department"
              style={{ width: phone ? "100%" : 200 }}
              value={departmentId}
              onChange={(val) => {
                setDepartmentId(val);
                setPage(1);
              }}
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
            />
            <Select
              allowClear
              showSearch={{ optionFilterProp: "label" }}
              placeholder="All branches"
              aria-label="Filter by branch"
              style={{ width: phone ? "100%" : 200 }}
              value={locationId}
              onChange={(val) => {
                setLocationId(val);
                setPage(1);
              }}
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
            />
          </>
        }
      />

      <QueryState
        isLoading={isLoading}
        error={data ? undefined : error}
        onRetry={() => void refetch()}
        skeleton={<DirectorySkeleton />}
        isEmpty={!data || data.items.length === 0}
        empty={
          search || activeCount > 0 ? (
            <EmptyState
              kind="no-results"
              title="No one matches these filters."
              description="Try a different name or code, or clear the filters."
              action={
                activeCount > 0 ? (
                  <Button onClick={clearAll}>Clear filters</Button>
                ) : undefined
              }
            />
          ) : (
            <EmptyState illustration="people" title="No one in the directory yet" description="Colleagues show up here once HR adds them." />
          )
        }
      >
        {data && (
          <div style={{ opacity: isFetching && !isLoading ? 0.6 : 1, transition: "opacity 0.15s" }} aria-busy={isFetching}>
            <div style={{ color: v.textSecondary, fontSize: fs.sm, marginBottom: space[3] }} aria-live="polite">
              {data.total} {data.total === 1 ? "person" : "people"}
            </div>
            <CardGrid min={phone ? 160 : 220} gap={phone ? space[3] : space[4]}>
              {data.items.map((person) => (
                <PersonCard key={person.id} person={person} onOpen={onOpenPerson} />
              ))}
            </CardGrid>
            {data.total > PAGE_SIZE && (
              <Pagination
                current={page}
                pageSize={PAGE_SIZE}
                total={data.total}
                onChange={(p) => {
                  setPage(p);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                showSizeChanger={false}
                simple={phone}
                align="center"
                style={{ marginTop: space[6] }}
              />
            )}
          </div>
        )}
      </QueryState>
    </div>
  );
}

// People (spec §6): the colleague directory and the org chart.
export function PeoplePage() {
  const [params, setParams] = useSearchParams();
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const tab = params.get("tab") === "org-chart" ? "org-chart" : "directory";

  return (
    <>
      <PageHeader title="People" subtitle="Find a colleague, or see who reports to whom" />
      <Panel>
        <Tabs
          activeKey={tab}
          onChange={(key) => setParams(key === "directory" ? {} : { tab: key }, { replace: true })}
          items={[
            { key: "directory", label: "Directory", children: <Directory onOpenPerson={setOpenPersonId} /> },
            { key: "org-chart", label: "Org Chart", children: <OrgChart onOpenPerson={setOpenPersonId} /> },
          ]}
        />
      </Panel>
      <PersonDrawer employeeId={openPersonId} onClose={() => setOpenPersonId(null)} onSelectPerson={setOpenPersonId} />
    </>
  );
}
