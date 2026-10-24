import { type Key, type ReactNode } from "react";
import { Pagination, Table, type TableColumnType, type TableProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { fs, fw, radius, space, v } from "../theme/tokens";
import { EmptyState } from "./EmptyState";
import { QueryState } from "./QueryState";
import { useIsPhone } from "./hooks";
import { SkeletonTable } from "./Skeletons";

export interface MobileCardSpec<T> {
  title: (row: T) => ReactNode;
  subtitle?: (row: T) => ReactNode;
  /** Top-right of the card, usually a StatusChip. */
  status?: (row: T) => ReactNode;
  /** Label/value pairs (2–4 is best). */
  fields?: { label: string; render: (row: T) => ReactNode }[];
  /** Row actions as buttons at the bottom of the card (≥ 44px on phones; never hover-only). */
  actions?: (row: T) => ReactNode;
  avatar?: (row: T) => ReactNode;
}

export interface DataTableProps<T> extends Omit<TableProps<T>, "size"> {
  /** How each row reads as a stacked card on phones. Derived from the columns when omitted. */
  mobile?: MobileCardSpec<T>;
  /** `comfortable` (64px rows, the board) or `compact` (44px, for dense grids: muster, swipes, registers). */
  density?: "comfortable" | "compact";
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  /** Opens the row (whole card on phones, row click on desktop). Keyboard: Enter on the focused row. */
  onRowOpen?: (row: T) => void;
  /** Show the board's "Showing 1 to 8 of 50 entries" text next to the pagination. */
  showTotal?: boolean;
}

function cellText<T>(col: TableColumnType<T>, row: T, index: number): ReactNode {
  const di = col.dataIndex as string | string[] | undefined;
  let value: unknown = undefined;
  if (Array.isArray(di)) value = di.reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], row);
  else if (di !== undefined) value = (row as Record<string, unknown>)[di];
  if (col.render) return col.render(value, row, index) as ReactNode;
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function deriveMobile<T>(columns: ColumnsType<T> | undefined): MobileCardSpec<T> {
  const cols = (columns ?? []).filter((c) => !("children" in c)) as TableColumnType<T>[];
  const [first, ...rest] = cols;
  const actionCol = rest.find((c) => (c.key === "actions" || c.key === "action" || c.title === "" || c.title === undefined) && c.render);
  const fieldCols = rest.filter((c) => c !== actionCol).slice(0, 5);
  return {
    title: (row) => (first ? cellText(first, row, 0) : null),
    fields: fieldCols.map((c, i) => ({ label: typeof c.title === "string" ? c.title : String(c.key ?? `Field ${i + 1}`), render: (row) => cellText(c, row, 0) })),
    actions: actionCol ? (row) => cellText(actionCol, row, 0) : undefined,
  };
}

function rowKeyOf<T>(row: T, rowKey: TableProps<T>["rowKey"], i: number): Key {
  if (typeof rowKey === "function") return rowKey(row, i);
  if (typeof rowKey === "string") return (row as Record<string, Key>)[rowKey] ?? i;
  return (row as Record<string, Key>).key ?? (row as Record<string, Key>).id ?? i;
}

// The board's table (employees-01): rounded header band, 64px rows, chips, row actions, pagination. On phones every row becomes a stacked card
// (DESIGN_SYSTEM.md §5). Server pagination passes straight through `pagination`; client lists over 100 rows without pagination are virtualised.
export function DataTable<T extends object>({
  mobile,
  density = "comfortable",
  error,
  onRetry,
  empty,
  onRowOpen,
  showTotal = true,
  loading,
  dataSource,
  columns,
  pagination,
  rowKey,
  scroll,
  onRow,
  locale,
  ...rest
}: DataTableProps<T>) {
  const phone = useIsPhone();
  const rows = (dataSource ?? []) as T[];
  const isLoading = Boolean(typeof loading === "object" ? loading.spinning : loading);
  const firstLoad = isLoading && rows.length === 0;

  if (error && rows.length === 0) return <QueryState isLoading={false} error={error} onRetry={onRetry}>{null}</QueryState>;
  if (firstLoad) return <SkeletonTable rows={density === "compact" ? 10 : 6} columns={Math.min((columns ?? []).length || 4, 6)} />;

  const emptyNode = empty ?? <EmptyState kind="empty" compact />;

  if (phone) {
    const spec = mobile ?? deriveMobile(columns);
    const pg = pagination === false ? null : pagination;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: space[3], opacity: isLoading ? 0.6 : 1, transition: "opacity 0.15s" }} aria-busy={isLoading}>
        {rows.length === 0
          ? emptyNode
          : rows.map((row, i) => {
              const open = onRowOpen ? () => onRowOpen(row) : undefined;
              return (
                <article
                  key={rowKeyOf(row, rowKey, i)}
                  onClick={open}
                  onKeyDown={open ? (e) => e.key === "Enter" && open() : undefined}
                  tabIndex={open ? 0 : undefined}
                  role={open ? "button" : undefined}
                  style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[4], cursor: open ? "pointer" : undefined }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
                    {spec.avatar?.(row)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: fw.semibold, color: v.textPrimary, fontSize: fs.md, wordBreak: "break-word" }}>{spec.title(row)}</div>
                      {spec.subtitle && <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: 2 }}>{spec.subtitle(row)}</div>}
                    </div>
                    {spec.status && <div style={{ flex: "none" }}>{spec.status(row)}</div>}
                  </div>
                  {spec.fields && spec.fields.length > 0 && (
                    <dl style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: `${space[2]}px ${space[4]}px`, margin: `${space[3]}px 0 0` }}>
                      {spec.fields.map((f) => (
                        <div key={f.label} style={{ minWidth: 0 }}>
                          <dt style={{ fontSize: fs.xs, color: v.textSecondary }}>{f.label}</dt>
                          <dd style={{ margin: 0, fontSize: fs.table, color: v.textBody, wordBreak: "break-word" }}>{f.render(row)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {spec.actions && (
                    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexWrap: "wrap", gap: space[2], marginTop: space[3], paddingTop: space[3], borderTop: `1px solid ${v.borderDefault}` }}>
                      {spec.actions(row)}
                    </div>
                  )}
                </article>
              );
            })}
        {pg && (pg.total ?? rows.length) > (pg.pageSize ?? 10) && (
          <Pagination simple current={pg.current} pageSize={pg.pageSize} total={pg.total} onChange={pg.onChange} style={{ alignSelf: "center", marginTop: space[2] }} />
        )}
      </div>
    );
  }

  const virtual = pagination === false && rows.length > 100;
  const pg =
    pagination === false
      ? false
      : {
          showSizeChanger: true,
          pageSizeOptions: [10, 25, 50, 100],
          ...(showTotal ? { showTotal: (total: number, range: [number, number]) => `Showing ${range[0]} to ${range[1]} of ${total} entries` } : {}),
          ...pagination,
        };

  return (
    <Table<T>
      {...rest}
      rowKey={rowKey}
      size={density === "compact" ? "small" : "middle"}
      dataSource={dataSource}
      columns={columns}
      loading={isLoading && rows.length > 0 ? { spinning: true, delay: 200 } : false}
      pagination={pg}
      virtual={virtual || rest.virtual}
      scroll={virtual ? { y: 640, x: scroll?.x ?? "max-content" } : { x: "max-content", ...scroll }}
      locale={{ emptyText: emptyNode, ...locale }}
      onRow={(row, i) => {
        const base = onRow?.(row, i) ?? {};
        if (!onRowOpen) return base;
        return {
          ...base,
          tabIndex: 0,
          style: { cursor: "pointer", ...base.style },
          onClick: (e) => {
            base.onClick?.(e);
            if (!(e.target as HTMLElement).closest("button, a, input, .ant-checkbox-wrapper, .ant-select")) onRowOpen(row);
          },
          onKeyDown: (e) => {
            base.onKeyDown?.(e);
            if (e.key === "Enter" && e.target === e.currentTarget) onRowOpen(row);
          },
        };
      }}
    />
  );
}
