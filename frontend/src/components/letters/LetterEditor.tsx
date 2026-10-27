import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { Button, Divider, Select, Tooltip } from "antd";
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
import { radius, space, v } from "../../theme/tokens";
import { useIsPhone } from "../../ui";

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
  bare = false,
}: {
  value: string;
  onChange?: (html: string) => void;
  placeholders?: PlaceholderOption[];
  readOnly?: boolean;
  /** Read-only without its own frame (inside a preview "page"). */
  bare?: boolean;
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

  const phone = useIsPhone();
  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const tool = (title: string, icon: React.ReactNode, active: boolean, run: () => void) => (
    <Tooltip title={title}>
      <Button size={phone ? "middle" : "small"} type={active ? "primary" : "text"} icon={icon} aria-label={title} aria-pressed={active} onClick={run} />
    </Tooltip>
  );

  return (
    <div className="letter-editor" data-readonly={readOnly || undefined} style={bare ? { color: v.textBody } : { border: `1px solid ${readOnly ? v.borderDefault : v.borderControl}`, borderRadius: radius.md, background: v.bgSurface, color: v.textBody }}>
      {!readOnly && (
        <div
          role="toolbar"
          aria-label="Formatting"
          style={{ display: "flex", flexWrap: "wrap", gap: space[1], alignItems: "center", padding: space[2], borderBottom: `1px solid ${v.borderDefault}`, background: v.bgSubtle, borderRadius: `${radius.md}px ${radius.md}px 0 0` }}
        >
          {tool("Bold", <BoldOutlined />, state?.bold ?? false, () => chain().toggleBold().run())}
          {tool("Italic", <ItalicOutlined />, state?.italic ?? false, () => chain().toggleItalic().run())}
          {tool("Underline", <UnderlineOutlined />, state?.underline ?? false, () => chain().toggleUnderline().run())}
          {tool("Strikethrough", <StrikethroughOutlined />, state?.strike ?? false, () => chain().toggleStrike().run())}
          <Divider orientation="vertical" />
          <Button size={phone ? "middle" : "small"} type={state?.h2 ? "primary" : "text"} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
            Heading
          </Button>
          <Button size={phone ? "middle" : "small"} type={state?.h3 ? "primary" : "text"} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
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
              size={phone ? "middle" : "small"}
              aria-label="Insert placeholder"
              style={{ minWidth: phone ? "100%" : 220, marginLeft: phone ? 0 : "auto" }}
              placeholder="Insert placeholder…"
              value={null}
              showSearch={{ optionFilterProp: "label" }}
              options={placeholders.map((p) => ({ value: p.key, label: p.label }))}
              onChange={(key: string) => chain().insertContent(`{{${key}}}`).run()}
            />
          )}
        </div>
      )}
      <EditorContent editor={editor} className={`letter-editor-content${readOnly ? " is-readonly" : ""}${bare ? " is-bare" : ""}`} />
      <style>{`
        .letter-editor:focus-within:not([data-readonly]) { border-color: ${v.focusRing}; box-shadow: 0 0 0 2px ${v.accentSubtle}; }
        .letter-editor-content .tiptap { min-height: ${phone ? 240 : 360}px; padding: ${space[4]}px ${phone ? space[4] : space[5]}px; outline: none; line-height: 1.6; color: ${v.textBody}; caret-color: ${v.textPrimary}; overflow-wrap: anywhere; }
        .letter-editor-content.is-readonly .tiptap { min-height: 0; }
        .letter-editor-content.is-bare .tiptap { padding: 0; }
        .letter-editor-content .tiptap p { margin: 0 0 ${space[2]}px; }
        .letter-editor-content .tiptap h1, .letter-editor-content .tiptap h2, .letter-editor-content .tiptap h3 { margin: ${space[2]}px 0; color: ${v.textPrimary}; }
        .letter-editor-content .tiptap blockquote { margin: ${space[2]}px 0; padding-left: ${space[3]}px; border-left: 3px solid ${v.borderControl}; color: ${v.textSecondary}; }
        .letter-editor-content .tiptap hr { border: 0; border-top: 1px solid ${v.borderDefault}; margin: ${space[3]}px 0; }
        .letter-editor-content .tiptap ::selection { background: ${v.accentSubtle}; }
      `}</style>
    </div>
  );
}
