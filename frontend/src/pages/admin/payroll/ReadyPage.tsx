import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Flex, Typography } from "antd";
import { Link } from "react-router-dom";
import * as payrollApi from "../../../api/payroll";
import type { Readiness } from "../../../api/payroll";
import { SetupStatusTag } from "../../../components/payroll/SetupStatusTag";
import { AccordionItem } from "../../../components/payroll/AccordionItem";
import { ProgressRow } from "../../../components/payroll/payrollUi";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { EmptyState, PageHeader, Panel, SkeletonCard, Stack } from "../../../ui";

const { Text } = Typography;

// Payroll → Ready for first real run (P6-6). Red until every required item is Confirmed, each by someone other than the person who entered it; and it says exactly what is missing.
// There is no switch and no stored flag: it is worked out again from the data every time this page is opened.

export function ReadyPage() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "ready"], queryFn: payrollApi.getReadiness });
  const header = <PageHeader title="Ready for first real run" subtitle="Worked out from what is entered, every time you open it" actions={<Link to="/admin/payroll/setup"><Button>Open the Setup Checklist</Button></Link>} />;
  if (isLoading)
    return (
      <>
        {header}
        <Stack>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={5} />
        </Stack>
      </>
    );
  if (error || !data)
    return (
      <>
        {header}
        <EmptyState kind="error" title="Could not work this out" description={apiErrorMessage(error, "Could not work this out.")} onRetry={() => void refetch()} />
      </>
    );
  const bySection = new Map<string, Readiness["blockers"]>();
  for (const b of data.blockers) bySection.set(b.sectionTitle, [...(bySection.get(b.sectionTitle) ?? []), b]);
  const confirmed = data.required - data.blockers.length;
  return (
    <>
      {header}
      <Stack>
        {data.ready ? (
          <Alert
            type="success"
            showIcon
            data-testid="ready-banner"
            title={data.demo ? "The demo company is complete." : "Ready for the first real payroll run."}
            description={data.demo ? "Green here means the made-up demo company is fully set up. It says nothing about any real company: a real one starts from an empty system." : `All ${data.required} required items are confirmed, each by a person other than the one who entered it.`}
          />
        ) : (
          <Alert
            type="error"
            showIcon
            data-testid="ready-banner"
            title="Not ready for the first real payroll run"
            description={`${data.blockers.length} of ${data.required} required items still need something. Until every one is confirmed by a person other than the one who entered it, a real run cannot be started.`}
          />
        )}
        <Panel>
          <Flex justify="space-between" align="center" gap={12} wrap>
            <Text type="secondary">Worked out just now ({formatDateTime(data.generatedAt)}) from what is entered. Nothing is switched on or off by hand.</Text>
            <ProgressRow done={confirmed} total={data.required} label="required items confirmed" width={160} />
          </Flex>
        </Panel>
        {[...bySection.entries()].map(([section, rows]) => (
          <Panel key={section} title={`${section} (${rows.length})`}>
            <Flex vertical gap={12}>
              {rows.map((b) => (
                <AccordionItem key={b.itemId} title={b.title} chips={<SetupStatusTag status={b.status} />} summary={<>What is missing: {b.missing}</>} right={<Link to={b.where.path}>{b.where.label}</Link>} />
              ))}
            </Flex>
          </Panel>
        ))}
        {data.notRequiredYet.length > 0 && (
          <Panel title={`Not needed for the first run (${data.notRequiredYet.length})`}>
            <Flex vertical gap={12}>
              {data.notRequiredYet.map((n) => (
                <AccordionItem key={n.itemId} title={n.title} chips={<SetupStatusTag status={n.status} />} summary={<>Why it can wait: {n.reason}</>} />
              ))}
            </Flex>
          </Panel>
        )}
        <Text type="secondary">
          The full list, with who entered and confirmed each thing, is on the <Link to="/admin/payroll/setup">Setup Checklist</Link>.
        </Text>
      </Stack>
    </>
  );
}
