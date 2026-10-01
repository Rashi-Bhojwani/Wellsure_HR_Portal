import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Button, Divider, Flex, Select, Tooltip } from "antd";
import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  AlignRightOutlined,
  BoldOutlined,
  ItalicOutlined,
  LineOutlined,
  OrderedListOutlined,
  RedoOutlined,
  StrikethroughOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";

export interface PlaceholderOption {
  key: string; // e.g. "employee.fullName" or "extra.ctcAnnual"
  label: string;
}

// The letter editor (Phase 5 commit D2, TipTap — HR writes these). Its
// extensions are exactly what the server's sanitizer keeps (headings,
// emphasis, lists, quote, rule, alignment); links/code/images aren't
// offered because they'd be stripped on save. Placeholders are inserted as
// one {{token}} from the menu, so they can't end up half-formatted.
export function LetterEditor({
  value,
  onChange,
  placeholders = [],
  readOnly = false,
}: {
  value: string;
  onChange?: (html: string) => void;
  placeholders?: PlaceholderOption[];
  readOnly?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, link: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
    ],
    content: value,
    editable: !readOnly,
    immediatelyRender: true,
    onUpdate: ({ editor: e }) => onChange?.(e.getHTML()),
  });

  // Replacing the content from outside (switching version, restoring) —
  // not on every keystroke, which would reset the cursor.
  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      strike: e?.isActive("strike") ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      h3: e?.isActive("heading", { level: 3 }) ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      left: e?.isActive({ textAlign: "left" }) ?? false,
      center: e?.isActive({ textAlign: "center" }) ?? false,
      right: e?.isActive({ textAlign: "right" }) ?? false,
    }),
  });

  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const tool = (title: string, icon: React.ReactNode, active: boolean, run: () => void) => (
    <Tooltip title={title}>
      <Button size="small" type={active ? "primary" : "text"} icon={icon} aria-label={title} aria-pressed={active} onClick={run} />
    </Tooltip>
  );

  return (
    <div className="letter-editor" style={{ border: "1px solid rgba(128,128,128,0.35)", borderRadius: 8 }}>
      {!readOnly && (
        <Flex wrap gap={4} align="center" style={{ padding: 6, borderBottom: "1px solid rgba(128,128,128,0.25)" }}>
          {tool("Bold", <BoldOutlined />, state?.bold ?? false, () => chain().toggleBold().run())}
          {tool("Italic", <ItalicOutlined />, state?.italic ?? false, () => chain().toggleItalic().run())}
          {tool("Underline", <UnderlineOutlined />, state?.underline ?? false, () => chain().toggleUnderline().run())}
          {tool("Strikethrough", <StrikethroughOutlined />, state?.strike ?? false, () => chain().toggleStrike().run())}
          <Divider orientation="vertical" />
          <Button size="small" type={state?.h2 ? "primary" : "text"} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
            Heading
          </Button>
          <Button size="small" type={state?.h3 ? "primary" : "text"} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
            Subheading
          </Button>
          <Divider orientation="vertical" />
          {tool("Bulleted list", <UnorderedListOutlined />, state?.bullet ?? false, () => chain().toggleBulletList().run())}
          {tool("Numbered list", <OrderedListOutlined />, state?.ordered ?? false, () => chain().toggleOrderedList().run())}
          {tool("Align left", <AlignLeftOutlined />, state?.left ?? false, () => chain().setTextAlign("left").run())}
          {tool("Centre", <AlignCenterOutlined />, state?.center ?? false, () => chain().setTextAlign("center").run())}
          {tool("Align right", <AlignRightOutlined />, state?.right ?? false, () => chain().setTextAlign("right").run())}
          {tool("Horizontal line", <LineOutlined />, false, () => chain().setHorizontalRule().run())}
          <Divider orientation="vertical" />
          {tool("Undo", <UndoOutlined />, false, () => chain().undo().run())}
          {tool("Redo", <RedoOutlined />, false, () => chain().redo().run())}
          {placeholders.length > 0 && (
            <Select
              size="small"
              style={{ minWidth: 220, marginLeft: "auto" }}
              placeholder="Insert placeholder…"
              value={null}
              showSearch={{ optionFilterProp: "label" }}
              options={placeholders.map((p) => ({ value: p.key, label: p.label }))}
              onChange={(key: string) => chain().insertContent(`{{${key}}}`).run()}
            />
          )}
        </Flex>
      )}
      <EditorContent editor={editor} className="letter-editor-content" />
      <style>{`
        .letter-editor-content .tiptap { min-height: ${readOnly ? 0 : 320}px; padding: 16px 20px; outline: none; line-height: 1.55; }
        .letter-editor-content .tiptap p { margin: 0 0 8px; }
        .letter-editor-content .tiptap h1, .letter-editor-content .tiptap h2, .letter-editor-content .tiptap h3 { margin: 8px 0; }
      `}</style>
    </div>
  );
}
