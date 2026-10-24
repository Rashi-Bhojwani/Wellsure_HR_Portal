import { useQuery } from "@tanstack/react-query";
import { Button, Card, Collapse, Empty, Flex, Space, Tabs, Tag, Typography, message } from "antd";
import type { ReactNode } from "react";
import { DownloadOutlined, FileTextOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import * as docsApi from "../../../api/documents";
import type { SignedDownload } from "../../../api/documents";
import { EmptyState } from "../../../components/common/EmptyState";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs } from "../../../theme/tokens";

async function download(get: () => Promise<SignedDownload>) {
  try {
    docsApi.startDownload(await get());
  } catch (err) {
    void message.error(apiErrorMessage(err, "Couldn't download that document."));
  }
}

// One document row. (AntD's List is deprecated — see docs/PROGRESS.md's
// Phase 0 follow-ups — so new screens don't add to it.)
function DocumentRow({ title, details, onDownload }: { title: ReactNode; details: ReactNode; onDownload: () => void }) {
  return (
    <Flex gap={12} align="center" justify="space-between" wrap style={{ padding: "12px 0", borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
      <Flex gap={12} align="flex-start" style={{ minWidth: 0, flex: 1 }}>
        <FileTextOutlined style={{ fontSize: fs.h2, marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <Typography.Text strong>{title}</Typography.Text>
          <div>{details}</div>
        </div>
      </Flex>
      <Button icon={<DownloadOutlined />} onClick={onDownload}>
        Download
      </Button>
    </Flex>
  );
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function CompanyDocuments() {
  const { data, isLoading } = useQuery({ queryKey: ["documents", "company"], queryFn: docsApi.listCompanyDocuments });
  if (isLoading || !data) return <EmptyState message="Loading…" />;
  if (data.length === 0) return <Empty description="No company documents have been published yet." />;

  // Grouped by category, in the category order HR set.
  const groups = new Map<string, { name: string; docs: docsApi.CompanyDocument[] }>();
  for (const doc of data) {
    const group = groups.get(doc.category.id) ?? { name: doc.category.name, docs: [] };
    group.docs.push(doc);
    groups.set(doc.category.id, group);
  }

  return (
    <Collapse
      defaultActiveKey={[...groups.keys()]}
      items={[...groups.entries()].map(([id, group]) => ({
        key: id,
        label: (
          <Space>
            {group.name}
            <Tag>{group.docs.length}</Tag>
          </Space>
        ),
        children: (
          <div>
            {group.docs.map((doc) => (
              <DocumentRow
                key={doc.id}
                title={doc.title}
                onDownload={() => download(() => docsApi.downloadCompanyDocument(doc.id))}
                details={
                  <Space orientation="vertical" size={0}>
                    {doc.description && <Typography.Text type="secondary">{doc.description}</Typography.Text>}
                    <Typography.Text type="secondary" style={{ fontSize: fs.sm }}>
                      {doc.fileName} · {docsApi.formatBytes(doc.sizeBytes)} · {formatDate(doc.uploadedAt)}
                      {(doc.scopeDepartment || doc.scopeLocation) && ` · For ${[doc.scopeDepartment?.name, doc.scopeLocation?.name].filter(Boolean).join(", ")}`}
                    </Typography.Text>
                  </Space>
                }
              />
            ))}
          </div>
        ),
      }))}
    />
  );
}

function MyDocuments() {
  const { data, isLoading } = useQuery({ queryKey: ["documents", "mine"], queryFn: docsApi.listMyDocuments });
  if (isLoading || !data) return <EmptyState message="Loading…" />;
  if (data.length === 0) return <Empty description="HR hasn't shared any documents with you yet." />;
  return (
    <div>
      {data.map((doc) => (
        <DocumentRow
          key={doc.id}
          title={
            <Space>
              {doc.title}
              <Tag>{doc.category.name}</Tag>
            </Space>
          }
          onDownload={() => download(() => docsApi.downloadMyDocument(doc.id))}
          details={
            <Typography.Text type="secondary" style={{ fontSize: fs.sm }}>
              {doc.fileName} · {docsApi.formatBytes(doc.sizeBytes)} · {formatDate(doc.uploadedAt)}
            </Typography.Text>
          }
        />
      ))}
    </div>
  );
}

function ComingSoon({ what, phase }: { what: string; phase: string }) {
  return <Empty description={`${what} will appear here once payroll goes live (${phase}).`} />;
}

// Document Center (spec §6): company policies and forms, my letters,
// payslips and Form 16 (the last two arrive with payroll).
export function DocumentCenterPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "company";
  return (
    <Card>
      <Tabs
        activeKey={tab}
        onChange={(key) => setParams(key === "company" ? {} : { tab: key }, { replace: true })}
        items={[
          { key: "company", label: "Policies & Forms", children: <CompanyDocuments /> },
          { key: "mine", label: "My Documents", children: <MyDocuments /> },
          { key: "payslips", label: "Payslips", children: <ComingSoon what="Payslips" phase="Phase 6" /> },
          { key: "form16", label: "Form 16", children: <ComingSoon what="Form 16" phase="Phase 7" /> },
        ]}
      />
    </Card>
  );
}
