import { useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Drawer, Flex, Input, Popover, Result, Select, Space, Spin, Typography, message, theme } from "antd";
import { CheckCircleOutlined, CloudUploadOutlined, ExportOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import * as musterApi from "../../../../api/muster";
import type { MusterQuery } from "../../../../api/muster";
import { HelpStrip } from "../../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../../lib/apiError";
import { useSocket } from "../../../../sockets/SocketProvider";
import { MusterGrid } from "./MusterGrid";
import { cellKey, useCellTones } from "./musterCells";
import { MusterUploadPanel } from "./MusterUploadPanel";

const { Title, Text } = Typography;

type CellErrors = Array<{ employeeId: string; date: string; error: string }>;

/**
 * Workforce → Attendance → Attendance Muster, and the employee portal's
 * Attendance → Mark Attendance for a manager who marks a branch by hand
 * (Phase 2 P2-D, docs/plans/PHASE_2.md §5).
 */
export function MusterPage({ title = "Attendance Muster" }: { title?: string }) {
  const { token } = theme.useToken();
  const tones = useCellTones();
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [query, setQuery] = useState<MusterQuery>({});
  const [pending, setPending] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [presentDay, setPresentDay] = useState<Dayjs | null>(null);
  const [presentBranch, setPresentBranch] = useState<string | undefined>();

  const cycles = useQuery({ queryKey: ["attendance", "muster", "cycles"], queryFn: musterApi.cycles });
  const muster = useQuery({ queryKey: ["attendance", "muster", query], queryFn: () => musterApi.getMuster(query), placeholderData: (prev) => prev, retry: false });
  const data = muster.data;

  // Live: any recompute (a punch, a leave decision, someone else's entry) refreshes the grid; unsaved typing stays.
  useEffect(() => {
    if (!socket) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["attendance", "muster"] });
    socket.on("attendance.updated", refresh);
    return () => void socket.off("attendance.updated", refresh);
  }, [socket, queryClient]);

  const pendingCount = Object.keys(pending).length;
  useEffect(() => {
    if (!pendingCount) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingCount]);

  const change = (key: string, text: string | null) => {
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setPending(({ [key]: _old, ...rest }) => (text === null ? rest : { ...rest, [key]: text }));
  };
  const setFilter = (patch: Partial<MusterQuery>) => {
    if (pendingCount && !window.confirm("You have unsaved changes in the muster. Discard them?")) return;
    setPending({});
    setErrors({});
    setQuery((q) => ({ ...q, ...patch }));
  };

  const save = useMutation({
    mutationFn: () =>
      musterApi.saveEntries(
        Object.entries(pending).map(([key, text]) => {
          const [employeeId, date] = key.split("|") as [string, string];
          // An emptied cell that had an entry clears the day (the grid only keeps it pending if it had one).
          return { employeeId, date, text: text.trim() === "" ? "-" : text, remark: remark.trim() || null };
        }),
      ),
    onSuccess: (r) => {
      void message.success(r.saved ? `Saved ${r.saved} ${r.saved === 1 ? "day" : "days"}.` : "Nothing changed.");
      setPending({});
      setErrors({});
      setRemark("");
      void queryClient.invalidateQueries({ queryKey: ["attendance", "muster"] });
    },
    onError: (err) => {
      const cells = (err as AxiosError<{ error?: { details?: { cells?: CellErrors } } }>).response?.data?.error?.details?.cells;
      if (cells) setErrors(Object.fromEntries(cells.map((c) => [cellKey(c.employeeId, c.date), c.error])));
      void message.error(apiErrorMessage(err, "Could not save the muster."));
    },
  });

  const markPresent = useMutation({
    mutationFn: () => musterApi.markAllPresent({ date: presentDay!.format("YYYY-MM-DD"), locationId: presentBranch! }),
    onSuccess: (r) => {
      void message.success(r.marked ? `Marked ${r.marked} present at the shift times. Change the exceptions in the grid.` : "Nobody was left unmarked that day.");
      setPresentDay(null);
      void queryClient.invalidateQueries({ queryKey: ["attendance", "muster"] });
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not mark that day.")),
  });

  const exportFile = useMutation({
    mutationFn: () => musterApi.exportMuster(query),
    onSuccess: (blob) => musterApi.saveBlob(blob, `attendance-muster-${data?.cycle.start ?? "cycle"}.xlsx`),
    onError: (err) => void message.error(apiErrorMessage(err, "Could not export the muster.")),
  });

  const cycleOptions = useMemo(() => (cycles.data?.cycles ?? []).map((c) => ({ value: c.start, label: c.label })), [cycles.data]);
  const markBranches = data?.filters.locations ?? [];

  if (muster.isError && !data) {
    const status = (muster.error as AxiosError).response?.status;
    return status === 403 ? (
      <Result status="403" title="No access to the muster" subTitle="You don't mark attendance for any branch. Admin assigns branches in Attendance Settings." />
    ) : (
      <Result status="error" title="Could not load the muster" subTitle={apiErrorMessage(muster.error, "Try again in a moment.")} />
    );
  }

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Flex align="center" gap={12} wrap>
        <Title level={3} style={{ margin: 0 }}>
          {title}
        </Title>
        <Select
          aria-label="Select attendance cycle"
          style={{ width: 210 }}
          value={query.cycleStart ?? cycles.data?.current.start}
          onChange={(v) => setFilter({ cycleStart: v })}
          options={cycleOptions}
          loading={cycles.isLoading}
        />
        {data && (
          <Text type="secondary">
            {dayjs(data.cycle.start).format("D MMM")} – {dayjs(data.cycle.end).format("D MMM YYYY")}
          </Text>
        )}
      </Flex>
      <HelpStrip storageKey="muster-help">
        Each row is one person, each column one day. For people marked by hand, click a day and type the IN and OUT times (10:05-19:10): they're worked out by
        exactly the same rules as a punch, so lateness and half days come out the same. If the times truly aren't known, type a status (P, A, P:A, A:P) — it's
        recorded as "status only". Tab or Enter moves on, then Save. Device days are read-only here.
      </HelpStrip>

      <Flex gap={8} wrap align="center">
        <Select allowClear placeholder="All branches" aria-label="Branch" style={{ width: 200 }} value={query.locationId} onChange={(v) => setFilter({ locationId: v })} options={(data?.filters.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        <Select allowClear placeholder="All departments" aria-label="Department" style={{ width: 200 }} value={query.departmentId} onChange={(v) => setFilter({ departmentId: v })} options={(data?.filters.departments ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="One employee"
          aria-label="Employee"
          style={{ width: 240 }}
          value={query.employeeId}
          onChange={(v) => setFilter({ employeeId: v })}
          options={(data?.filters.employees ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.employeeCode})` }))}
        />
        <div style={{ flex: 1 }} />
        {data?.canMark && (
          <>
            <Popover
              trigger="click"
              open={presentDay !== null}
              onOpenChange={(o) => setPresentDay(o ? dayjs(data.today) : null)}
              title="Mark everyone present"
              content={
                <Space orientation="vertical" style={{ width: 260 }}>
                  <Text type="secondary">Fills every unmarked working day at the shift's start and end times, then you change the exceptions. Nothing already marked is touched.</Text>
                  <DatePicker value={presentDay} onChange={setPresentDay} disabledDate={(d) => d.isAfter(dayjs(data.today))} style={{ width: "100%" }} allowClear={false} />
                  <Select placeholder="Branch" aria-label="Branch to mark" value={presentBranch} onChange={setPresentBranch} options={markBranches.map((l) => ({ value: l.id, label: l.name }))} />
                  <Button type="primary" block disabled={!presentBranch || !presentDay} loading={markPresent.isPending} onClick={() => markPresent.mutate()}>
                    Mark all present
                  </Button>
                </Space>
              }
            >
              <Button icon={<CheckCircleOutlined />}>Mark all present</Button>
            </Popover>
            <Button icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>
              Upload muster
            </Button>
          </>
        )}
        <Button icon={<ExportOutlined />} loading={exportFile.isPending} onClick={() => exportFile.mutate()} disabled={!data}>
          Export to Excel
        </Button>
      </Flex>

      {!data ? (
        <Flex justify="center" style={{ padding: 48 }}>
          <Spin />
        </Flex>
      ) : data.rows.length === 0 ? (
        <Alert type="info" showIcon title="Nobody to show for this cycle and filter." />
      ) : (
        <MusterGrid muster={data} pending={pending} errors={errors} onChange={change} focused={focused} onFocus={setFocused} />
      )}

      {pendingCount > 0 && (
        <Card size="small" style={{ position: "sticky", bottom: 8, zIndex: 5, borderColor: token.colorWarningBorder, boxShadow: token.boxShadowSecondary }}>
          <Flex gap={8} align="center" wrap>
            <Text strong>
              {pendingCount} unsaved {pendingCount === 1 ? "change" : "changes"}
            </Text>
            {Object.keys(errors).length > 0 && <Text type="danger">{Object.keys(errors).length} to fix (hover the red cells)</Text>}
            <Input placeholder="Remark for these changes (optional), e.g. confirmed by phone" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={200} style={{ flex: 1, minWidth: 220 }} />
            <Button icon={<UndoOutlined />} onClick={() => (setPending({}), setErrors({}))}>
              Discard
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </Flex>
        </Card>
      )}

      {data && (
        <Card size="small" title="Legend">
          <Flex gap={24} wrap>
            <div>
              <Text type="secondary">What a day shows</Text>
              <Flex gap={6} wrap style={{ marginTop: 6, maxWidth: 560 }}>
                {data.legend.map((l) => {
                  const tone = tones(l.code.split(/[ ,/]/)[0]!);
                  return (
                    <span key={l.code} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 8 }}>
                      <span style={{ background: tone.background, color: tone.color, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 4, padding: "0 6px", fontWeight: 500, fontSize: 12 }}>{l.code}</span>
                      <Text style={{ fontSize: 12 }}>{l.label}</Text>
                    </span>
                  );
                })}
              </Flex>
              <Flex gap={16} wrap style={{ marginTop: 8, fontSize: 12 }}>
                <span><span style={{ display: "inline-block", width: 14, height: 14, verticalAlign: "middle", boxShadow: `inset 0 0 0 1px ${token.colorTextQuaternary}`, marginRight: 4, textDecoration: "underline dotted" }} />Status only, no times</span>
                <span><span style={{ display: "inline-block", width: 0, height: 0, borderTop: `8px solid ${token.colorError}`, borderLeft: "8px solid transparent", marginRight: 4 }} />One time only (forgot to punch out?)</span>
                <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 6, background: token.colorSuccess, marginRight: 4 }} />Worked on an off day</span>
                <span><span style={{ display: "inline-block", width: 14, height: 14, verticalAlign: "middle", background: token.colorWarningBgHover, marginRight: 4 }} />Unsaved</span>
                <span>🔒 Finalised</span>
              </Flex>
            </div>
            {data.canMark && (
              <div>
                <Text type="secondary">What you can type</Text>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12 }}>
                  {data.inputHelp.map((h) => (
                    <li key={h.code}>
                      <Text code>{h.code}</Text> {h.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Flex>
        </Card>
      )}

      <Drawer open={uploadOpen} onClose={() => setUploadOpen(false)} size={720} title="Upload a filled-in muster" destroyOnHidden>
        {data && <MusterUploadPanel branches={markBranches} cycles={cycles.data?.cycles ?? []} defaultBranch={query.locationId} defaultCycle={data.cycle.start} />}
      </Drawer>
    </Space>
  );
}
