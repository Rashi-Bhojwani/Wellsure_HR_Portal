import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Select, Tooltip } from "antd";
import { InfoCircleOutlined, LeftOutlined, PlusOutlined, RightOutlined } from "@ant-design/icons";
import * as leaveApi from "../../../api/leave";
import { LeaveLedgerTable } from "../../../components/leave/LeaveLedgerTable";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { EmptyState, PageHeader, Panel, QueryState, Skel, Stack, useIsPhone } from "../../../ui";

const CARD_WIDTH = 240;

function BalanceCard({ b }: { b: leaveApi.LeaveBalanceCard }) {
  const info = `${b.code} · ${b.isPaid ? "Paid" : "Unpaid"} leave${b.allowHalfDay ? " · half days allowed" : ""}`;
  return (
    <article
      aria-label={`${b.name}: ${b.balance} day(s) balance, ${b.granted} granted`}
      style={{
        flex: `0 0 ${CARD_WIDTH}px`,
        scrollSnapAlign: "start",
        background: v.bgSurface,
        border: `1px solid ${v.borderDefault}`,
        borderRadius: radius.lg,
        padding: space[5],
        display: "flex",
        flexDirection: "column",
        gap: space[2],
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: space[2] }}>
        <span style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, lineHeight: 1.35 }}>{b.name}</span>
        <Tooltip title={info}>
          <InfoCircleOutlined tabIndex={0} aria-label={info} style={{ color: v.textSecondary, marginTop: 4 }} />
        </Tooltip>
      </div>
      <div className="ws-num" style={{ fontSize: fs.stat, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.2, marginTop: "auto" }}>
        {b.balance}
        <span style={{ fontSize: fs.md, fontWeight: fw.medium, color: v.textSecondary, marginInlineStart: space[1] }}>{Math.abs(b.balance) === 1 ? "day" : "days"}</span>
      </div>
      <span style={{ fontSize: fs.sm, color: v.textSecondary }}>Granted: {b.granted}</span>
    </article>
  );
}

// The board's horizontally scrolling balance strip (time-off-01), with prev/next buttons on desktop and swipe on phones. Balances are the API's
// numbers (sum of the append-only ledger) — never computed or edited here.
function BalanceStrip({ balances }: { balances: leaveApi.LeaveBalanceCard[] }) {
  const phone = useIsPhone();
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, balances.length]);

  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * (CARD_WIDTH + space[4]) * 2, behavior: "smooth" });
  const overflowing = !(edges.start && edges.end);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[3] }}>
      {!phone && overflowing && (
        <Tooltip title="Previous">
          <Button shape="circle" aria-label="Previous leave types" icon={<LeftOutlined />} disabled={edges.start} onClick={() => scroll(-1)} />
        </Tooltip>
      )}
      <div
        ref={ref}
        onScroll={measure}
        role="list"
        aria-label="Leave balances"
        style={{ display: "flex", gap: space[4], overflowX: "auto", scrollSnapType: "x mandatory", scrollbarWidth: "none", flex: 1, minWidth: 0, paddingBottom: 2 }}
      >
        {balances.map((b) => (
          <div role="listitem" key={b.leaveTypeId} style={{ display: "flex" }}>
            <BalanceCard b={b} />
          </div>
        ))}
      </div>
      {!phone && overflowing && (
        <Tooltip title="Next">
          <Button shape="circle" aria-label="Next leave types" icon={<RightOutlined />} disabled={edges.end} onClick={() => scroll(1)} />
        </Tooltip>
      )}
    </div>
  );
}

export function LeaveBalancesPage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { data: balances = [], isLoading, error, refetch } = useQuery({ queryKey: ["leave", "balances", "me"], queryFn: () => leaveApi.getLeaveBalances() });
  const year = new Date().getFullYear();

  return (
    <>
      <PageHeader
        title="Leave Balances"
        subtitle="Your balance for each leave type, and every credit and debit behind it"
        actions={
          <>
            <Select aria-label="Year" defaultValue={year} style={{ width: phone ? "100%" : 110 }} options={[{ value: year, label: String(year) }]} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/app/leave/apply")} block={phone}>
              Apply
            </Button>
          </>
        }
      />
      <Stack>
        <QueryState
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          isEmpty={balances.length === 0}
          empty={
            <Panel>
              <EmptyState compact illustration="calendar" title="No leave types configured yet." description="Your balances will appear here once HR sets up leave types." />
            </Panel>
          }
          skeleton={
            <div style={{ display: "flex", gap: space[4], overflow: "hidden" }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skel key={i} w={CARD_WIDTH} h={138} r={radius.lg} style={{ flex: `0 0 ${CARD_WIDTH}px` }} />
              ))}
            </div>
          }
        >
          <BalanceStrip balances={balances} />
        </QueryState>

        <Panel title="Balance history" subtitle="Newest first">
          <LeaveLedgerTable />
        </Panel>
      </Stack>
    </>
  );
}
