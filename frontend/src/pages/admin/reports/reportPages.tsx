import { ReportPage } from "./ReportPage";

// One menu entry per core report (Phase 5 commit F) — thin wrappers so the
// menu config can name a component, as every other admin page does.
export const HeadcountReportPage = () => <ReportPage reportKey="headcount" />;
export const JoinersReportPage = () => <ReportPage reportKey="joiners" />;
export const LeaversReportPage = () => <ReportPage reportKey="leavers" />;
export const CelebrationsReportPage = () => <ReportPage reportKey="celebrations" />;
export const LeaveBalanceReportPage = () => <ReportPage reportKey="leave-balance" />;
export const LeaveLiabilityReportPage = () => <ReportPage reportKey="leave-liability" />;
export const LopReportPage = () => <ReportPage reportKey="lop" />;
