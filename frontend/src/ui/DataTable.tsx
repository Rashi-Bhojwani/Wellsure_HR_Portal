import { useRef, useState, type Key, type ReactNode } from "react";
import { Checkbox, Pagination, Radio, Table, type TableColumnType, type TableProps } from "antd";
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
  /**
   * With `rowSelection`, each card gets a selection checkbox (and "Select all on this page" above the cards). Set `false` when the spec already renders
   * its own selection control on the card.
   */
  selection?: boolean;
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
  // Phone card mode: client-side paging (as antd's Table does on desktop when no onChange is given) and uncontrolled selection.
  const [localPage, setLocalPage] = useState<number | undefined>(undefined);
  const [localSize, setLocalSize] = useState<number | undefined>(undefined);
  const [localKeys, setLocalKeys] = useState<Key[]>([]);
  const cardsRef = useRef<HTMLDivElement>(null);
  const isLoading = Boolean(typeof loading === "object" ? loading.spinning : loading);
  const firstLoad = isLoading && rows.length === 0;

  if (error && rows.length === 0) return <QueryState isLoading={false} error={error} onRetry={onRetry}>{null}</QueryState>;
  if (firstLoad) return <SkeletonTable rows={density === "compact" ? 10 : 6} columns={Math.min((columns ?? []).length || 4, 6)} />;

  const emptyNode = empty ?? <EmptyState kind="empty" compact />;

  if (phone) {
    const spec = mobile ?? deriveMobile(columns);
    const pg = pagination === false ? null : (pagination ?? {});
    // Server-side when the page drives it (onChange) or says there are more rows than it gave us; otherwise slice here, like antd does on desktop.
    const server = !!pg && (!!pg.onChange || (pg.total !== undefined && pg.total > rows.length));
    const pageSize = (server ? pg?.pageSize : (localSize ?? pg?.pageSize)) ?? pg?.defaultPageSize ?? 10;
    const total = server ? (pg?.total ?? rows.length) : rows.length;
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const current = server ? (pg?.current ?? 1) : Math.min(localPage ?? pg?.current ?? pg?.defaultCurrent ?? 1, lastPage);
    const visible = pg && !server ? rows.slice((current - 1) * pageSize, current * pageSize) : rows;

    const sel = spec.selection === false ? undefined : rest.rowSelection;
    const selKeys = sel ? (sel.selectedRowKeys ?? localKeys) : [];
    const radio = sel?.type === "radio";
    const keyOf = (row: T) => rowKeyOf(row, rowKey, rows.indexOf(row));
    const setKeys = (keys: Key[], method: "single" | "multiple" | "all") => {
      if (!sel) return;
      if (!sel.selectedRowKeys) setLocalKeys(keys);
      const picked = rows.filter((r) => keys.includes(keyOf(r)));
      sel.onChange?.(keys, picked, { type: method });
    };
    const selectable = visible.filter((r) => !sel?.getCheckboxProps?.(r)?.disabled);
    const pageKeys = selectable.map(keyOf);
    const pageChecked = pageKeys.filter((k) => selKeys.includes(k)).length;
    const hit = { minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", marginInlineEnd: 0 } as const;

    return (
      <div ref={cardsRef} style={{ display: "flex", flexDirection: "column", gap: space[3], opacity: isLoading ? 0.6 : 1, transition: "opacity 0.15s" }} aria-busy={isLoading}>
        {sel && !radio && sel.hideSelectAll !== true && pageKeys.length > 0 && (
          <Checkbox
            checked={pageChecked === pageKeys.length}
            indeterminate={pageChecked > 0 && pageChecked < pageKeys.length}
            onChange={(e) =>
              setKeys(e.target.checked ? [...new Set([...selKeys, ...pageKeys])] : selKeys.filter((k) => !pageKeys.includes(k)), "all")
            }
            style={{ minHeight: 44, alignItems: "center", alignSelf: "flex-start" }}
          >
            Select all on this page{selKeys.length > 0 ? ` (${selKeys.length} selected)` : ""}
          </Checkbox>
        )}
        {visible.length === 0
          ? emptyNode
          : visible.map((row, i) => {
              const open = onRowOpen ? () => onRowOpen(row) : undefined;
              const key = rowKeyOf(row, rowKey, rows.indexOf(row) >= 0 ? rows.indexOf(row) : i);
              const cbProps = sel?.getCheckboxProps?.(row);
              const checked = selKeys.includes(key);
              const titleNode = spec.title(row);
              const label = `Select ${typeof titleNode === "string" || typeof titleNode === "number" ? titleNode : "row"}`;
              const toggle = (on: boolean) => setKeys(radio ? (on ? [key] : []) : on ? [...selKeys, key] : selKeys.filter((k) => k !== key), radio ? "single" : "multiple");
              return (
                <article
                  key={key}
                  onClick={open}
                  onKeyDown={open ? (e) => e.key === "Enter" && e.target === e.currentTarget && open() : undefined}
                  tabIndex={open ? 0 : undefined}
                  role={open ? "button" : undefined}
                  style={{
                    background: v.bgSurface,
                    border: `1px solid ${checked ? v.accent : v.borderDefault}`,
                    borderRadius: radius.md,
                    padding: space[4],
                    cursor: open ? "pointer" : undefined,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
                    {sel && (
                      // The control's own label is the 44px hit area; clicks on it never open the row.
                      <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", flex: "none", margin: `-${space[3]}px 0 -${space[3]}px -${space[3]}px` }}>
                        {radio ? (
                          <Radio checked={checked} disabled={cbProps?.disabled} onChange={(e) => toggle(e.target.checked)} aria-label={label} style={hit} />
                        ) : (
                          <Checkbox checked={checked} disabled={cbProps?.disabled} onChange={(e) => toggle(e.target.checked)} aria-label={label} style={hit} />
                        )}
                      </span>
                    )}
                    {spec.avatar?.(row)}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: fw.semibold, color: v.textPrimary, fontSize: fs.md, wordBreak: "break-word" }}>{titleNode}</div>
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
        {pg && total > pageSize && (
          <Pagination
            simple
            current={current}
            pageSize={pageSize}
            total={total}
            onChange={(page, size) => {
              // The pager sits under the cards: bring the new page's first card into view (below the sticky header), not its last.
              requestAnimationFrame(() => {
                const top = cardsRef.current?.getBoundingClientRect().top;
                const headerBottom = document.querySelector(".ws-header")?.getBoundingClientRect().bottom ?? 0;
                if (top !== undefined && top < headerBottom) window.scrollBy({ top: top - headerBottom - space[3], behavior: "smooth" });
              });
              if (server) pg.onChange?.(page, size);
              else {
                setLocalPage(page);
                setLocalSize(size);
                pg.onChange?.(page, size);
              }
            }}
            style={{ alignSelf: "center", marginTop: space[2] }}
          />
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
