import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Checkbox, Dropdown, Input, Modal, Select, type MenuProps } from "antd";
import { DownloadOutlined, PlusOutlined, SaveOutlined, SettingOutlined } from "@ant-design/icons";
import * as employeeApi from "../../../api/employee";
import * as orgApi from "../../../api/org";
import { useAuth } from "../../../hooks/useAuth";
import { EmployeeAvatar } from "../../../components/common/EmployeeAvatar";
import { ConfirmModal, DataTable, FilterBar, PageHeader, Panel, StatusChip, toast, useIsPhone } from "../../../ui";
import { fs, fw, space, v } from "../../../theme/tokens";

const ALL_COLUMNS = [
  { key: "employeeCode", title: "Code" },
  { key: "fullName", title: "Name" },
  { key: "department", title: "Department" },
  { key: "designation", title: "Designation" },
  { key: "location", title: "Location" },
  { key: "city", title: "City" },
  { key: "manager", title: "Manager" },
  { key: "dateOfJoining", title: "DOJ" },
  { key: "status", title: "Status" },
  { key: "employmentType", title: "Type" },
  { key: "mobile", title: "Mobile" },
  { key: "personalEmail", title: "Personal Email" },
] as const;
type ColumnKey = (typeof ALL_COLUMNS)[number]["key"];
const DEFAULT_COLUMNS: ColumnKey[] = ["employeeCode", "fullName", "department", "designation", "location", "status"];
type Row = employeeApi.EmployeeGridRow;

const REFERENCE_STALE = 30_000;

function NameCell({ row }: { row: Row }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
      <EmployeeAvatar employeeId={row.id} name={row.fullName} photoVersion={row.photoVersion} size={36} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary, whiteSpace: "nowrap" }}>{row.fullName}</div>
        <div style={{ fontSize: fs.sm, color: v.textSecondary, whiteSpace: "nowrap" }}>
          {row.employeeCode}
          {row.officialEmail ? ` · ${row.officialEmail}` : ""}
        </div>
      </div>
    </div>
  );
}

export function AllEmployeesPage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("employee.create");
  const canExport = hasPermission("employee.export");
  const canSeeSensitive = hasPermission("employee.bank.view") || hasPermission("employee.statutory.view");

  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState<string>();
  const [locationId, setLocationId] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(DEFAULT_COLUMNS);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [exporting, setExporting] = useState<"plain" | "sensitive" | null>(null);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");

  const query = { search: search || undefined, departmentId, locationId, status, page, pageSize, sortBy: "employeeCode" as const, sortDir: "asc" as const };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["employees", "grid", query],
    queryFn: () => employeeApi.listEmployees(query),
    placeholderData: keepPreviousData,
  });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, staleTime: REFERENCE_STALE });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations", "all"], queryFn: () => orgApi.listLocations(true), staleTime: REFERENCE_STALE });
  const { data: savedViews = [], refetch: refetchViews } = useQuery({ queryKey: ["employees", "saved-views"], queryFn: () => employeeApi.listSavedViews() });

  const openProfile = (row: Row) => navigate(`/admin/employee/profile/${row.id}`);

  const columns = useMemo(
    () =>
      ALL_COLUMNS.filter((c) => visibleColumns.includes(c.key)).map((c) => ({
        title: c.title,
        dataIndex: c.key,
        key: c.key,
        render:
          c.key === "status"
            ? (val: string) => <StatusChip status={val} />
            : c.key === "fullName"
              ? (_: string, record: Row) => <NameCell row={record} />
              : (val: unknown) => (val === null || val === undefined || val === "" ? "—" : String(val)),
      })),
    [visibleColumns],
  );

  const columnMenuItems: MenuProps["items"] = ALL_COLUMNS.map((c) => ({
    key: c.key,
    label: (
      <Checkbox
        checked={visibleColumns.includes(c.key)}
        onChange={(e) => setVisibleColumns((prev) => (e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key)))}
      >
        {c.title}
      </Checkbox>
    ),
  }));

  async function doExport(includeSensitive: boolean) {
    setExporting(includeSensitive ? "sensitive" : "plain");
    try {
      const blob = await employeeApi.exportEmployees({ ...query, page: undefined, pageSize: undefined, includeSensitive });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employees-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setExportConfirmOpen(false);
    } catch {
      toast.error("Export failed.");
    } finally {
      setExporting(null);
    }
  }

  async function saveCurrentView() {
    if (!viewName.trim()) return;
    await employeeApi.createSavedView({ name: viewName.trim(), config: { search, departmentId, locationId, status, columns: visibleColumns } });
    setSaveViewOpen(false);
    setViewName("");
    void refetchViews();
    toast.success("View saved.");
  }

  function applyView(view: employeeApi.SavedView) {
    const config = view.config as { search?: string; departmentId?: string; locationId?: string; status?: string; columns?: ColumnKey[] };
    setSearch(config.search ?? "");
    setDepartmentId(config.departmentId);
    setLocationId(config.locationId);
    setStatus(config.status);
    setPage(1);
    if (config.columns) setVisibleColumns(config.columns);
  }

  const resetPage = <T,>(set: (val: T) => void) => (val: T) => {
    set(val);
    setPage(1);
  };
  const activeCount = [departmentId, locationId, status].filter(Boolean).length;
  const selectWidth = phone ? "100%" : 180;

  return (
    <>
      <PageHeader
        title="Employees"
        subtitle="Everyone in the company, with their job and status"
        actions={
          <>
            {canExport && (
              <Button
                size="large"
                icon={<DownloadOutlined />}
                loading={exporting !== null && !exportConfirmOpen}
                onClick={() => (canSeeSensitive ? setExportConfirmOpen(true) : void doExport(false))}
                style={phone ? { flex: 1 } : undefined}
              >
                Export
              </Button>
            )}
            {canCreate && (
              <Button size="large" type="primary" icon={<PlusOutlined />} onClick={() => navigate("/admin/employee/add")} style={phone ? { flex: 1 } : undefined}>
                Add employee
              </Button>
            )}
          </>
        }
      />

      <Panel>
        <FilterBar
          onSearch={resetPage(setSearch)}
          searchValue={search}
          searchPlaceholder="Search name, code, email, mobile"
          activeCount={activeCount}
          onClear={() => {
            setDepartmentId(undefined);
            setLocationId(undefined);
            setStatus(undefined);
            setPage(1);
          }}
          filters={
            <>
              <Select
                placeholder="All departments"
                aria-label="Department"
                allowClear
                showSearch={{ optionFilterProp: "label" }}
                style={{ width: selectWidth }}
                value={departmentId}
                onChange={resetPage(setDepartmentId)}
                options={departments.map((d) => ({ value: d.id, label: d.name }))}
              />
              <Select
                placeholder="All locations"
                aria-label="Location"
                allowClear
                showSearch={{ optionFilterProp: "label" }}
                style={{ width: selectWidth }}
                value={locationId}
                onChange={resetPage(setLocationId)}
                options={locations.map((l) => ({ value: l.id, label: l.name }))}
              />
              <Select
                placeholder="All status"
                aria-label="Status"
                allowClear
                style={{ width: phone ? "100%" : 150 }}
                value={status}
                onChange={resetPage(setStatus)}
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Inactive" },
                  { value: "SEPARATED", label: "Separated" },
                ]}
              />
              {savedViews.length > 0 && (
                <Select
                  placeholder="Saved views"
                  aria-label="Saved views"
                  style={{ width: selectWidth }}
                  onChange={(id) => {
                    const sv = savedViews.find((x) => x.id === id);
                    if (sv) applyView(sv);
                  }}
                  options={savedViews.map((sv) => ({ value: sv.id, label: sv.name }))}
                />
              )}
            </>
          }
          actions={
            <>
              <Dropdown menu={{ items: columnMenuItems }} trigger={["click"]}>
                <Button icon={<SettingOutlined />}>Columns</Button>
              </Dropdown>
              <Button icon={<SaveOutlined />} onClick={() => setSaveViewOpen(true)}>
                Save view
              </Button>
            </>
          }
        />

        <DataTable<Row>
          rowKey="id"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data?.rows ?? []}
          columns={columns}
          onRowOpen={openProfile}
          pagination={{
            current: page,
            pageSize,
            total: data?.total ?? 0,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          mobile={{
            avatar: (r) => <EmployeeAvatar employeeId={r.id} name={r.fullName} photoVersion={r.photoVersion} size={40} />,
            title: (r) => r.fullName,
            subtitle: (r) => r.employeeCode,
            status: (r) => <StatusChip status={r.status} />,
            fields: [
              { label: "Designation", render: (r) => r.designation },
              { label: "Department", render: (r) => r.department },
            ],
          }}
        />
      </Panel>

      <ConfirmModal
        open={exportConfirmOpen}
        onCancel={() => setExportConfirmOpen(false)}
        title="Export includes sensitive data"
        description="You have permission to export masked bank account and statutory details (last 4 digits only — never the full number). This action is audit-logged. Choose whether to include those columns in this export."
        cancelLabel={null}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space[3], marginTop: space[2] }}>
          <Button size="large" block loading={exporting === "plain"} disabled={exporting === "sensitive"} onClick={() => void doExport(false)}>
            Export without bank/PAN/Aadhaar
          </Button>
          <Button size="large" block type="primary" danger loading={exporting === "sensitive"} disabled={exporting === "plain"} onClick={() => void doExport(true)}>
            Include bank/PAN/Aadhaar (last 4 only)
          </Button>
        </div>
      </ConfirmModal>

      <Modal title="Save current view" open={saveViewOpen} onCancel={() => setSaveViewOpen(false)} onOk={() => void saveCurrentView()} okText="Save view" okButtonProps={{ disabled: !viewName.trim() }} destroyOnHidden>
        <Input autoFocus placeholder="View name" aria-label="View name" value={viewName} onChange={(e) => setViewName(e.target.value)} onPressEnter={() => void saveCurrentView()} />
      </Modal>
    </>
  );
}
