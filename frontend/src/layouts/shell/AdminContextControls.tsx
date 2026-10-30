import { DatePicker, Select } from "antd";
import { TeamOutlined } from "@ant-design/icons";
import { useAdminFilters } from "../../context/AdminFiltersContext";
import { space } from "../../theme/tokens";

// Stage 1: the branch names that used to be listed here were typed in by hand. Branches are data (Organisation Setup), never code, so the list is only "All employees" until this filter
// is built to read them from the server and to change what a page shows.
// The admin portal's global context (docs/UI_REFERENCE.md §2.0): payroll month and employee filter, in the top bar on desktop. Loaded lazily by AdminLayout so
// the date picker (and dayjs) stays out of the shell's first download.
export function AdminContextControls() {
  const { payrollMonth, setPayrollMonth, employeeFilter, setEmployeeFilter } = useAdminFilters();
  return (
    <div style={{ display: "flex", gap: space[2], alignItems: "center" }}>
      <DatePicker picker="month" aria-label="Payroll month" value={payrollMonth} onChange={(m) => m && setPayrollMonth(m)} allowClear={false} format="[Payroll] MMM YYYY" style={{ width: 168 }} />
      <Select
        aria-label="Employee filter"
        value={employeeFilter}
        onChange={setEmployeeFilter}
        suffixIcon={<TeamOutlined />}
        style={{ width: 168 }}
        options={[{ value: "all", label: "All employees" }]}
      />
    </div>
  );
}
