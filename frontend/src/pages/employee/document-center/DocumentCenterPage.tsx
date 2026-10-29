import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Tabs } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useSearchParams } from "react-router-dom";
import * as docsApi from "../../../api/documents";
import type { SignedDownload } from "../../../api/documents";
import { apiErrorMessage } from "../../../lib/apiError";
import { space } from "../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, StatusChip, toast, useIsPhone, type Crumb } from "../../../ui";
import { FileName, FolderName, SquareAction } from "./docBits";

async function download(get: () => Promise<SignedDownload>) {
  try {
    docsApi.startDownload(await get());
  } catch (err) {
    toast.error(apiErrorMessage(err, "Couldn't download that document."));
  }
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

interface Folder {
  id: string;
  name: string;
  docs: docsApi.CompanyDocument[];
  sizeBytes: number;
  latest: string;
}

function useCompanyFolders() {
  const query = useQuery({ queryKey: ["documents", "company"], queryFn: docsApi.listCompanyDocuments });
  const folders = useMemo(() => {
    // Grouped by category, in the category order HR set.
    const map = new Map<string, Folder>();
    for (const doc of query.data ?? []) {
      const f = map.get(doc.category.id) ?? { id: doc.category.id, name: doc.category.name, docs: [], sizeBytes: 0, latest: doc.uploadedAt };
      f.docs.push(doc);
      f.sizeBytes += doc.sizeBytes;
      if (doc.uploadedAt > f.latest) f.latest = doc.uploadedAt;
      map.set(doc.category.id, f);
    }
    return [...map.values()];
  }, [query.data]);
  return { ...query, folders };
}

const scopeText = (doc: docsApi.CompanyDocument) => (doc.scopeDepartment || doc.scopeLocation ? `For ${[doc.scopeDepartment?.name, doc.scopeLocation?.name].filter(Boolean).join(", ")}` : "Everyone");

function CompanyDocuments({ folderId, openFolder }: { folderId: string | null; openFolder: (id: string | null) => void }) {
  const { folders, isLoading, error, refetch } = useCompanyFolders();
  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;

  if (folderId && folder) {
    return (
      <DataTable<docsApi.CompanyDocument>
        rowKey="id"
        dataSource={folder.docs}
        pagination={folder.docs.length > 10 ? { pageSize: 10 } : false}
        columns={[
          {
            title: "Name",
            key: "name",
            render: (_, doc) => <FileName title={doc.title} caption={doc.description ?? doc.fileName} mimeType={doc.mimeType} fileName={doc.fileName} />,
          },
          { title: "Size", key: "size", render: (_, doc) => docsApi.formatBytes(doc.sizeBytes) },
          { title: "Published", key: "date", render: (_, doc) => formatDate(doc.uploadedAt) },
          { title: "Shared with", key: "scope", render: (_, doc) => scopeText(doc) },
          {
            title: "Action",
            key: "actions",
            align: "right",
            render: (_, doc) => <SquareAction tone="edit" icon={<DownloadOutlined />} label={`Download ${doc.title}`} onClick={() => void download(() => docsApi.downloadCompanyDocument(doc.id))} />,
          },
        ]}
        mobile={{
          title: (doc) => <FileName title={doc.title} caption={`${doc.fileName} · ${docsApi.formatBytes(doc.sizeBytes)}`} mimeType={doc.mimeType} fileName={doc.fileName} />,
          fields: [
            { label: "Published", render: (doc) => formatDate(doc.uploadedAt) },
            { label: "Shared with", render: (doc) => scopeText(doc) },
          ],
          actions: (doc) => (
            <Button block icon={<DownloadOutlined />} onClick={() => void download(() => docsApi.downloadCompanyDocument(doc.id))}>
              Download
            </Button>
          ),
        }}
      />
    );
  }

  return (
    <DataTable<Folder>
      rowKey="id"
      loading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      dataSource={folders}
      pagination={false}
      onRowOpen={(f) => openFolder(f.id)}
      empty={<EmptyState illustration="documents" title="There's no document here" description="No company documents have been published yet." />}
      columns={[
        { title: "Name", key: "name", render: (_, f) => <FolderName name={f.name} /> },
        { title: "Number of files", key: "count", render: (_, f) => f.docs.length },
        { title: "Size", key: "size", render: (_, f) => docsApi.formatBytes(f.sizeBytes) },
        { title: "Last updated", key: "latest", render: (_, f) => formatDate(f.latest) },
        { title: "", key: "open", align: "right", render: (_, f) => <Button onClick={() => openFolder(f.id)} aria-label={`Open ${f.name}`}>Open</Button> },
      ]}
      mobile={{
        title: (f) => <FolderName name={f.name} caption={`${f.docs.length} file${f.docs.length === 1 ? "" : "s"} · ${docsApi.formatBytes(f.sizeBytes)}`} />,
        fields: [{ label: "Last updated", render: (f) => formatDate(f.latest) }],
      }}
    />
  );
}

function MyDocuments() {
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["documents", "mine"], queryFn: docsApi.listMyDocuments });
  return (
    <DataTable<docsApi.EmployeeDocument>
      rowKey="id"
      loading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      dataSource={data}
      pagination={data.length > 10 ? { pageSize: 10 } : false}
      empty={<EmptyState illustration="documents" title="There's no document here" description="HR hasn't shared any documents with you yet." />}
      columns={[
        { title: "Name", key: "name", render: (_, doc) => <FileName title={doc.title} caption={doc.fileName} mimeType={doc.mimeType} fileName={doc.fileName} /> },
        { title: "Category", key: "category", render: (_, doc) => <StatusChip tone="neutral">{doc.category.name}</StatusChip> },
        { title: "Size", key: "size", render: (_, doc) => docsApi.formatBytes(doc.sizeBytes) },
        { title: "Shared on", key: "date", render: (_, doc) => formatDate(doc.uploadedAt) },
        {
          title: "Action",
          key: "actions",
          align: "right",
          render: (_, doc) => <SquareAction tone="edit" icon={<DownloadOutlined />} label={`Download ${doc.title}`} onClick={() => void download(() => docsApi.downloadMyDocument(doc.id))} />,
        },
      ]}
      mobile={{
        title: (doc) => <FileName title={doc.title} caption={`${doc.fileName} · ${docsApi.formatBytes(doc.sizeBytes)}`} mimeType={doc.mimeType} fileName={doc.fileName} />,
        status: (doc) => <StatusChip tone="neutral">{doc.category.name}</StatusChip>,
        fields: [{ label: "Shared on", render: (doc) => formatDate(doc.uploadedAt) }],
        actions: (doc) => (
          <Button block icon={<DownloadOutlined />} onClick={() => void download(() => docsApi.downloadMyDocument(doc.id))}>
            Download
          </Button>
        ),
      }}
    />
  );
}

function ComingSoon({ what, phase }: { what: string; phase: string }) {
  return <EmptyState illustration="documents" title={`No ${what.toLowerCase()} yet`} description={`${what} will appear here once payroll goes live (${phase}).`} />;
}

// Document Center (spec §6): company policies and forms, my letters,
// payslips and Form 16 (the last two arrive with payroll).
export function DocumentCenterPage() {
  const [params, setParams] = useSearchParams();
  const phone = useIsPhone();
  const tab = params.get("tab") ?? "company";
  const folderId = tab === "company" ? params.get("folder") : null;
  // The folder name for the breadcrumb comes from the same (cached) query the folder list uses.
  const { folders } = useCompanyFolders();
  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;

  const openFolder = (id: string | null) => setParams(id ? { folder: id } : {});
  const breadcrumb: Crumb[] | undefined = folder ? [{ label: "Document Center", to: "/app/document-center" }, { label: folder.name }] : undefined;

  return (
    <>
      <PageHeader
        title={folder ? folder.name : "Document Center"}
        subtitle="Policies, forms and the documents HR has shared with you"
        breadcrumb={breadcrumb}
        back={folder ? "/app/document-center" : undefined}
      />
      <Panel bodyStyle={{ paddingTop: phone ? space[1] : space[2] }}>
        <Tabs
          activeKey={tab}
          onChange={(key) => setParams(key === "company" ? {} : { tab: key }, { replace: true })}
          items={[
            { key: "company", label: "Policies & Forms", children: <CompanyDocuments folderId={folderId} openFolder={openFolder} /> },
            { key: "mine", label: "My Documents", children: <MyDocuments /> },
            { key: "payslips", label: "Payslips", children: <ComingSoon what="Payslips" phase="Phase 6" /> },
            { key: "form16", label: "Form 16", children: <ComingSoon what="Form 16" phase="Phase 7" /> },
          ]}
        />
      </Panel>
    </>
  );
}
