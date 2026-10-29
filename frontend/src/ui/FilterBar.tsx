import { useEffect, useState, type ReactNode } from "react";
import { Badge, Button, Drawer, Input } from "antd";
import { FilterOutlined, SearchOutlined } from "@ant-design/icons";
import { space } from "../theme/tokens";
import { useDebouncedValue, useIsPhone } from "./hooks";

export interface FilterBarProps {
  /** Debounced (250 ms) search; omit for no search box. Called with the settled value. */
  onSearch?: (value: string) => void;
  searchPlaceholder?: string;
  /** Initial / controlled-from-outside value of the search box. */
  searchValue?: string;
  /** Selects, date ranges… On phones they move into a "Filter" sheet. */
  filters?: ReactNode;
  /** How many filters are set (badge on the phone's Filter button). */
  activeCount?: number;
  onClear?: () => void;
  /** Buttons that stay visible on the right (Export, Columns…). */
  actions?: ReactNode;
  style?: React.CSSProperties;
}

// The board's filter row (employees-01): search with a trailing icon + selects. Phones: a "Filter" button opening a sheet, as m-employees-02.
export function FilterBar({ onSearch, searchPlaceholder = "Search", searchValue = "", filters, activeCount = 0, onClear, actions, style }: FilterBarProps) {
  const phone = useIsPhone();
  const [text, setText] = useState(searchValue);
  const [sheet, setSheet] = useState(false);
  const settled = useDebouncedValue(text, 250);

  // When the parent changes searchValue (e.g. "Clear filters"), adopt it — adjusted during render, not in an effect.
  const [syncedFrom, setSyncedFrom] = useState(searchValue);
  if (syncedFrom !== searchValue) {
    setSyncedFrom(searchValue);
    setText(searchValue);
  }
  useEffect(() => {
    if (settled !== searchValue) onSearch?.(settled);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire only when the typed value settles
  }, [settled]);

  const search = onSearch && (
    <Input
      allowClear
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={searchPlaceholder}
      aria-label={searchPlaceholder}
      suffix={<SearchOutlined aria-hidden />}
      style={{ flex: phone ? 1 : "1 1 280px", maxWidth: phone ? undefined : 420, minWidth: 0 }}
    />
  );

  if (phone) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: space[3], marginBottom: space[4], ...style }}>
        <div style={{ display: "flex", gap: space[2] }}>
          {search}
          {filters && (
            <Badge count={activeCount} size="small">
              <Button icon={<FilterOutlined />} onClick={() => setSheet(true)}>
                Filter
              </Button>
            </Badge>
          )}
        </div>
        {actions && <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>{actions}</div>}
        {filters && (
          <Drawer
            title="Filter"
            placement="bottom"
            open={sheet}
            onClose={() => setSheet(false)}
            styles={{ body: { display: "flex", flexDirection: "column", gap: space[3] }, wrapper: { height: "auto", maxHeight: "85vh" } }}
            footer={
              <div style={{ display: "flex", gap: space[3] }}>
                {onClear && (
                  <Button block onClick={onClear}>
                    Clear
                  </Button>
                )}
                <Button block type="primary" onClick={() => setSheet(false)}>
                  Show results
                </Button>
              </div>
            }
          >
            <div className="ws-filter-sheet">{filters}</div>
          </Drawer>
        )}
      </div>
    );
  }

  return (
    <div role="search" style={{ display: "flex", flexWrap: "wrap", gap: space[3], alignItems: "center", marginBottom: space[5], ...style }}>
      {search}
      {filters}
      {onClear && activeCount > 0 && (
        <Button type="link" onClick={onClear}>
          Clear filters
        </Button>
      )}
      {actions && <div style={{ display: "flex", gap: space[2], marginLeft: "auto", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
