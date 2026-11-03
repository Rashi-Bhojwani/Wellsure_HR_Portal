import { useQuery } from "@tanstack/react-query";
import * as parityApi from "../../../../api/parity";
import { DataTable, EmptyState, QueryState, SkeletonTable, StatusChip } from "../../../../ui";
import { ProfileSection, SectionStack } from "../ProfileLayout";

// A-9 G1 (item 6): the profile's Pay tab. Shown only to people holding payroll.salary.view (the directors; HR never can — the server refuses it too).
// Every opening is written to the audit log by the server; nothing here is cached between visits.
export function PayTab({ employeeId }: { employeeId: string }) {
  const pay = useQuery({ queryKey: ["employees", "pay", employeeId], queryFn: () => parityApi.openPay(employeeId), gcTime: 0, staleTime: 0 });
  return (
    <SectionStack>
      <ProfileSection title="Salary history">
        <QueryState isLoading={pay.isLoading} error={pay.error} onRetry={() => void pay.refetch()} skeleton={<SkeletonTable rows={3} />}>
          {pay.data && pay.data.history.length === 0 ? (
            <EmptyState compact title="No salary on file yet." description="Salaries are entered in Payroll → Employee Salaries." />
          ) : (
            <DataTable
              rowKey="id"
              dataSource={pay.data?.history ?? []}
              pagination={false}
              columns={[
                { title: "From", dataIndex: "effectiveFrom", key: "from" },
                { title: "Until", dataIndex: "effectiveTo", key: "to", render: (v: string | null) => v ?? "—" },
                { title: "Status", dataIndex: "status", key: "status", render: (v: string) => <StatusChip status={v} /> },
                { title: "Structure", dataIndex: "structure", key: "structure" },
                { title: "Annual CTC", dataIndex: "annualCtc", key: "annual", align: "right" as const },
                { title: "Monthly CTC", dataIndex: "monthlyCtc", key: "monthly", align: "right" as const },
              ]}
              mobile={{
                title: (r) => `${r.effectiveFrom} · ${r.structure}`,
                status: (r) => <StatusChip status={r.status} />,
                fields: [
                  { label: "Annual CTC", render: (r) => r.annualCtc },
                  { label: "Monthly CTC", render: (r) => r.monthlyCtc },
                ],
              }}
            />
          )}
        </QueryState>
      </ProfileSection>
    </SectionStack>
  );
}
