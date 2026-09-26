import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  Checkbox,
  Dropdown,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  type MenuProps,
} from "antd";
import { DownloadOutlined, SettingOutlined, UserAddOutlined } from "@ant-design/icons";
import * as employeeApi from "../../../api/employee";
import * as orgApi from "../../../api/org";
import { useAuth } from "../../../hooks/useAuth";

const { Title } = Typography;

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

const STATUS_COLORS: Record<string, string> = { ACTIVE: "green", INACTIVE: "orange", SEPARATED: "default" };

export function AllEmployeesPage() {
  const navigate = useNavigate();
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
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");

  const query = { search: search || undefined, departmentId, locationId, status, page, pageSize, sortBy: "employeeCode" as const, sortDir: "asc" as const };

  const { data, isLoading } = useQuery({
    queryKey: ["employees", "grid", query],
    queryFn: () => employeeApi.listEmployees(query),
  });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations", "all"], queryFn: () => orgApi.listLocations(true) });
  const { data: savedViews = [], refetch: refetchViews } = useQuery({ queryKey: ["employees", "saved-views"], queryFn: () => employeeApi.listSavedViews() });

  const columns = useMemo(
    () =>
      ALL_COLUMNS.filter((c) => visibleColumns.includes(c.key)).map((c) => ({
        title: c.title,
        dataIndex: c.key,
        render:
          c.key === "status"
            ? (v: string) => <Tag color={STATUS_COLORS[v]}>{v}</Tag>
            : c.key === "fullName"
              ? (v: string, record: employeeApi.EmployeeGridRow) => (
                  <a onClick={() => navigate(`/admin/employee/profile/${record.id}`)}>{v}</a>
                )
              : undefined,
      })),
    [visibleColumns, navigate],
  );

  const columnMenuItems: MenuProps["items"] = ALL_COLUMNS.map((c) => ({
    key: c.key,
    label: (
      <Checkbox
        checked={visibleColumns.includes(c.key)}
        onChange={(e) =>
          setVisibleColumns((prev) => (e.target.checked ? [...prev, c.key] : prev.filter((k) => k !== c.key)))
        }
      >
        {c.title}
      </Checkbox>
    ),
  }));

  async function doExport(includeSensitive: boolean) {
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
      void message.error("Export failed.");
    }
  }

  async function saveCurrentView() {
    if (!viewName.trim()) return;
    await employeeApi.createSavedView({ name: viewName.trim(), config: { search, departmentId, locationId, status, columns: visibleColumns } });
    setSaveViewOpen(false);
    setViewName("");
    void refetchViews();
    void message.success("View saved.");
  }

  function applyView(view: employeeApi.SavedView) {
    const config = view.config as { search?: string; departmentId?: string; locationId?: string; status?: string; columns?: ColumnKey[] };
    setSearch(config.search ?? "");
    setDepartmentId(config.departmentId);
    setLocationId(config.locationId);
    setStatus(config.status);
    if (config.columns) setVisibleColumns(config.columns);
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Title level={3} style={{ margin: 0 }}>
          All Employees
        </Title>
        {canCreate && (
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => navigate("/admin/employee/add")}>
            Add Employee
          </Button>
        )}
      </Space>

      <Space wrap>
        <Input.Search placeholder="Search name, code, email, mobile" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} allowClear />
        <Select placeholder="Department" allowClear style={{ width: 180 }} value={departmentId} onChange={setDepartmentId} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
        <Select placeholder="Location" allowClear style={{ width: 180 }} value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
        <Select placeholder="Status" allowClear style={{ width: 140 }} value={status} onChange={setStatus} options={[{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }, { value: "SEPARATED", label: "Separated" }]} />
        {savedViews.length > 0 && (
          <Select placeholder="Saved views" style={{ width: 180 }} onChange={(id) => { const v = savedViews.find((sv) => sv.id === id); if (v) applyView(v); }} options={savedViews.map((v) => ({ value: v.id, label: v.name }))} />
        )}
        <Button onClick={() => setSaveViewOpen(true)}>Save view</Button>
        <Dropdown menu={{ items: columnMenuItems }} trigger={["click"]}>
          <Button icon={<SettingOutlined />}>Columns</Button>
        </Dropdown>
        {canExport && (
          <Button icon={<DownloadOutlined />} onClick={() => (canSeeSensitive ? setExportConfirmOpen(true) : void doExport(false))}>
            Export
          </Button>
        )}
      </Space>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.rows ?? []}
        columns={columns}
        scroll={{ x: "max-content" }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Modal
        title="Export includes sensitive data"
        open={exportConfirmOpen}
        onCancel={() => setExportConfirmOpen(false)}
        footer={[
          <Button key="plain" onClick={() => void doExport(false)}>
            Export without bank/PAN/Aadhaar
          </Button>,
          <Button key="sensitive" type="primary" danger onClick={() => void doExport(true)}>
            Include bank/PAN/Aadhaar (last 4 only)
          </Button>,
        ]}
      >
        <Typography.Paragraph>
          You have permission to export masked bank account and statutory details (last 4 digits only — never the full
          number). This action is audit-logged. Choose whether to include those columns in this export.
        </Typography.Paragraph>
      </Modal>

      <Modal title="Save current view" open={saveViewOpen} onCancel={() => setSaveViewOpen(false)} onOk={() => void saveCurrentView()} destroyOnHidden>
        <Input placeholder="View name" value={viewName} onChange={(e) => setViewName(e.target.value)} onPressEnter={() => void saveCurrentView()} />
      </Modal>
    </Space>
  );
}
