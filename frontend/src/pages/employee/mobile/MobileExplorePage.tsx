import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Flex, Space, Tag, Typography, theme } from "antd";
import { DownOutlined, RightOutlined, UpOutlined } from "@ant-design/icons";
import { exploreEntries, isComingSoon, isEmployeeMenuGroup, type EmployeeMenuLeaf } from "../../../routes/employeeMenu.config";
import { tintFor } from "./tints";

const { Text } = Typography;

const areaOf = (key: string, children?: EmployeeMenuLeaf[]) => children?.[0]?.path.split("/")[0] ?? key;

// Mobile Explore tab (Phase 5 commit G, docs/UI_REFERENCE.md Part 4 §4.2):
// every menu section except the ones that are tabs themselves. A group is an
// expandable card listing its pages; a single page is a card that opens it.
// Pages not built yet (or over data that doesn't exist yet: attendance,
// payroll) are listed greyed with "Coming soon" and don't open.
export function MobileExplorePage() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [open, setOpen] = useState<string | null>(null);

  const leafRow = (leaf: EmployeeMenuLeaf) => {
    const soon = isComingSoon(leaf);
    const Icon = leaf.icon;
    return (
      <Flex
        key={leaf.key}
        align="center"
        gap={12}
        role={soon ? undefined : "link"}
        aria-disabled={soon || undefined}
        onClick={soon ? undefined : () => navigate(`/app/${leaf.path}`)}
        style={{ padding: "10px 4px", borderTop: `1px solid ${token.colorSplit}`, cursor: soon ? "default" : "pointer", opacity: soon ? 0.55 : 1 }}
      >
        <span style={{ fontSize: 16, color: token.colorTextSecondary }}>{Icon && <Icon />}</span>
        <Text style={{ flex: 1 }}>{leaf.label}</Text>
        {soon ? <Tag>Coming soon</Tag> : <RightOutlined style={{ color: token.colorTextQuaternary, fontSize: 12 }} />}
      </Flex>
    );
  };

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {exploreEntries().map((entry, i) => {
        const group = isEmployeeMenuGroup(entry) ? entry : null;
        const tint = tintFor(areaOf(entry.key, group?.children), i, token);
        const Icon = entry.icon;
        const isOpen = open === entry.key;
        const soon = !group && isComingSoon(entry as EmployeeMenuLeaf);
        const onClick = group ? () => setOpen(isOpen ? null : entry.key) : soon ? undefined : () => navigate(`/app/${(entry as EmployeeMenuLeaf).path}`);
        return (
          <Card key={entry.key} style={{ background: tint.bg, borderColor: "transparent" }} styles={{ body: { padding: 16 } }}>
            <Flex align="center" gap={12} onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }} role="button" aria-expanded={group ? isOpen : undefined}>
              <div style={{ flex: 1 }}>
                <Flex align="center" gap={8}>
                  <Text strong style={{ fontSize: 20 }}>
                    {entry.label}
                  </Text>
                  {group && (isOpen ? <UpOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />)}
                  {soon && <Tag>Coming soon</Tag>}
                </Flex>
                {entry.description && <Text type="secondary">{entry.description}</Text>}
              </div>
              <span style={{ fontSize: 30, color: tint.fg }}>{Icon && <Icon />}</span>
            </Flex>
            {group && isOpen && <div style={{ marginTop: 10 }}>{group.children.map(leafRow)}</div>}
          </Card>
        );
      })}
    </Space>
  );
}
