import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Collapse, Flex, Spin, Table, Typography } from "antd";
import { Link } from "react-router-dom";
import * as payrollApi from "../../../api/payroll";
import type { Readiness } from "../../../api/payroll";
import { SetupStatusTag } from "../../../components/payroll/SetupStatusTag";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";

const { Title, Text } = Typography;

// Payroll → Ready for first real run (P6-6). Red until every required item is Confirmed, each by someone other than the person who entered it; and it says exactly what is missing.
// There is no switch and no stored flag: it is worked out again from the data every time this page is opened.

export function ReadyPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "ready"], queryFn: payrollApi.getReadiness });
  if (isLoading) return <Spin />;
  if (error || !data) return <Alert type="error" showIcon title={apiErrorMessage(error, "Could not work this out.")} />;
  const bySection = new Map<string, Readiness["blockers"]>();
  for (const b of data.blockers) bySection.set(b.sectionTitle, [...(bySection.get(b.sectionTitle) ?? []), b]);
  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Ready for first real run
      </Title>
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
      <Text type="secondary">Worked out just now ({formatDateTime(data.generatedAt)}) from what is entered. Nothing is switched on or off by hand.</Text>
      {[...bySection.entries()].map(([section, rows]) => (
        <Card key={section} size="small" title={`${section} (${rows.length})`}>
          <Table
            size="small"
            rowKey="itemId"
            pagination={false}
            dataSource={rows}
            columns={[
              { title: "What", dataIndex: "title" },
              { title: "Now", render: (_, b) => <SetupStatusTag status={b.status} /> },
              { title: "What is missing", dataIndex: "missing" },
              { title: "Where", render: (_, b) => <Link to={b.where.path}>{b.where.label}</Link> },
            ]}
          />
        </Card>
      ))}
      {data.notRequiredYet.length > 0 && (
        <Collapse
          items={[
            {
              key: "later",
              label: `Not needed for the first run (${data.notRequiredYet.length})`,
              children: <Table size="small" rowKey="itemId" pagination={false} dataSource={data.notRequiredYet} columns={[{ title: "What", dataIndex: "title" }, { title: "Now", render: (_, n) => <SetupStatusTag status={n.status} /> }, { title: "Why it can wait", dataIndex: "reason" }]} />,
            },
          ]}
        />
      )}
      <Text type="secondary">
        The full list, with who entered and confirmed each thing, is on the <Link to="/admin/payroll/setup">Setup Checklist</Link>.
      </Text>
    </Flex>
  );
}
