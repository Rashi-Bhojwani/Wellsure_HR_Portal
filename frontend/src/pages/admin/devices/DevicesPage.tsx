import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, Tabs } from "antd";
import { AlertOutlined, DisconnectOutlined, FlagOutlined, PlusOutlined, UsbOutlined } from "@ant-design/icons";
import * as biometricApi from "../../../api/biometric";
import type { DeviceRow } from "../../../api/biometric";
import { DeviceWarnings } from "../../../components/devices/DeviceWarnings";
import { IngestionVolumeChart } from "../../../components/devices/IngestionVolumeChart";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { space } from "../../../theme/tokens";
import { CardGrid, PageHeader, Panel, Stack, StatCard, StatusChip, useIsPhone } from "../../../ui";
import { AgentsTab } from "./AgentsTab";
import { BatchesTab } from "./BatchesTab";
import { DEVICE_TABS, type DeviceTab } from "./deviceLabels";
import { DeviceDrawer, DevicesTab } from "./DevicesTab";
import { FlaggedTab } from "./FlaggedTab";
import { IncidentsTab } from "./IncidentsTab";
import { UnmappedTab } from "./UnmappedTab";

function VolumeTab() {
  const { data: devices = [] } = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  return <IngestionVolumeChart devices={devices.map((d) => ({ id: d.id, name: d.name }))} />;
}

const TabLabel = ({ label, count, tone }: { label: string; count: number; tone: "danger" | "warning" }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
    {label}
    {count > 0 && <StatusChip tone={tone}>{String(count)}</StatusChip>}
  </span>
);

// Admin Tools → Devices (Phase 2 P2-B; P2-F adds what the sync agent reports
// and the warnings; P2-H adds health at a glance, the incident history, and
// ingestion volume). Every query here sits under ["biometric"], which the
// device.status socket event invalidates, so health and counts stay live.
export function DevicesPage() {
  const phone = useIsPhone();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get("tab") ?? "";
  const tab: DeviceTab = (DEVICE_TABS as readonly string[]).includes(raw) ? (raw as DeviceTab) : "devices"; // links from other screens (Finalisation, Exceptions) open a tab
  const setTab = (key: string) => setSearchParams({ tab: key }, { replace: true });
  const devicesQuery = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices });
  const { data: unmapped = [], isLoading: unmappedLoading } = useQuery({ queryKey: ["biometric", "unmapped"], queryFn: biometricApi.listUnmapped });
  const { data: flagged, isLoading: flaggedLoading } = useQuery({ queryKey: ["biometric", "flagged", "count"], queryFn: () => biometricApi.listFlagged() });
  const { data: openIncidents = [], isLoading: incidentsLoading } = useQuery({ queryKey: ["biometric", "incidents", "open"], queryFn: () => biometricApi.listIncidents({ state: "open", limit: 100 }) });
  const [editing, setEditing] = useState<DeviceRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const devices = devicesQuery.data ?? [];
  const active = devices.filter((d) => d.isActive);
  const online = active.filter((d) => d.status === "ONLINE").length;
  const register = () => {
    setEditing(null);
    setDrawerOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Devices"
        subtitle="Biometric machines, the sync agents that read them, and every punch on its way in."
        actions={
          <Button type="primary" icon={<PlusOutlined />} onClick={register} block={phone}>
            Register a device
          </Button>
        }
      />
      <Stack>
        <HelpStrip storageKey="biometric-devices-help">
          Biometric machines and the sync agents that read them. Punches arrive through the agent (primary), ADMS push, or an emergency file upload (Import Center), and all go through the same checks: exact
          duplicates are dropped, implausible times are flagged, and punches nobody&apos;s device ID covers wait in Unmapped. The agent only ever reads a device: it never changes, clears or pauses it, and never
          sets its clock.
        </HelpStrip>
        <DeviceWarnings />
        <CardGrid min={200} gap={space[4]}>
          <StatCard label="Devices online" value={`${online} of ${active.length}`} icon={<UsbOutlined />} tone="accent" loading={devicesQuery.isLoading} onClick={() => setTab("devices")} info="Active devices heard from recently with nothing open against them." />
          <StatCard label="Open incidents" value={openIncidents.length} icon={<AlertOutlined />} tone={openIncidents.length ? "danger" : "neutral"} loading={incidentsLoading} onClick={() => setTab("incidents")} />
          <StatCard label="Unmapped device IDs" value={unmapped.length} icon={<DisconnectOutlined />} tone={unmapped.length ? "warning" : "neutral"} loading={unmappedLoading} onClick={() => setTab("unmapped")} />
          <StatCard label="Flagged punches" value={flagged?.total ?? 0} icon={<FlagOutlined />} tone={flagged?.total ? "warning" : "neutral"} loading={flaggedLoading} onClick={() => setTab("flagged")} />
        </CardGrid>
        <Panel>
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: "devices",
                label: "Devices",
                children: (
                  <DevicesTab
                    onRegister={register}
                    onEdit={(d) => {
                      setEditing(d);
                      setDrawerOpen(true);
                    }}
                  />
                ),
              },
              { key: "agents", label: "Sync agents", children: <AgentsTab /> },
              { key: "incidents", label: <TabLabel label="Incidents" count={openIncidents.length} tone="danger" />, children: <IncidentsTab /> },
              { key: "volume", label: "Volume", children: <VolumeTab /> },
              { key: "unmapped", label: <TabLabel label="Unmapped" count={unmapped.length} tone="warning" />, children: <UnmappedTab /> },
              { key: "flagged", label: <TabLabel label="Flagged" count={flagged?.total ?? 0} tone="warning" />, children: <FlaggedTab /> },
              { key: "batches", label: "Recent batches", children: <BatchesTab /> },
            ]}
          />
        </Panel>
      </Stack>
      <DeviceDrawer editing={editing} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
