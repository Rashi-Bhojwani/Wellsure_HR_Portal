/* eslint-disable react-refresh/only-export-components -- context + hook are colocated by design */
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import dayjs, { type Dayjs } from "dayjs";

// Global admin-portal context (docs/UI_REFERENCE.md §2.0): the Payroll
// Month selector and the employee filter (All / location / department)
// shown top-right on every inner admin page, sent with every request once
// real endpoints exist (Phase 1+). Static/local state for now — nothing
// re-fetches off it yet.

export type EmployeeFilterValue = "all" | string;

interface AdminFiltersValue {
  payrollMonth: Dayjs;
  setPayrollMonth: (month: Dayjs) => void;
  employeeFilter: EmployeeFilterValue;
  setEmployeeFilter: (value: EmployeeFilterValue) => void;
}

const AdminFiltersContext = createContext<AdminFiltersValue | undefined>(undefined);

export function AdminFiltersProvider({ children }: { children: ReactNode }) {
  const [payrollMonth, setPayrollMonth] = useState<Dayjs>(dayjs());
  const [employeeFilter, setEmployeeFilter] = useState<EmployeeFilterValue>("all");

  const value = useMemo(
    () => ({ payrollMonth, setPayrollMonth, employeeFilter, setEmployeeFilter }),
    [payrollMonth, employeeFilter],
  );

  return <AdminFiltersContext.Provider value={value}>{children}</AdminFiltersContext.Provider>;
}

export function useAdminFilters(): AdminFiltersValue {
  const ctx = useContext(AdminFiltersContext);
  if (!ctx) throw new Error("useAdminFilters must be used within AdminFiltersProvider");
  return ctx;
}
