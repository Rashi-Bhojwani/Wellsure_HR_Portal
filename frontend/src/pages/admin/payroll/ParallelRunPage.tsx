import { ParallelRunPanel } from "../../../components/payroll/greythr/ParallelRunPanel";
import { PageHeader } from "../../../ui";

// Payroll → Parallel run (Stage 8, docs/plans/STAGE_8_PLAN.md; IE-12, PY-32), directors only: greytHR's salary statement against the portal's run for the month.
export function ParallelRunPage() {
  return (
    <>
      <PageHeader title="Parallel run" subtitle="greytHR's salary statement for a month against the portal's run for the same month. It reads only; payroll is not changed." />
      <ParallelRunPanel />
    </>
  );
}

export default ParallelRunPage;
