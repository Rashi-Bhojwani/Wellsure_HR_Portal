import { message } from "antd";
import type { ReactNode } from "react";

// One way to say "done" / "that failed" (DESIGN_SYSTEM.md §6.15): Ant Design's message, which announces through an aria-live region. 4 s; errors 6 s.
// Prefer it over ad-hoc alerts for transient results. Errors from the API go through apiErrorMessage() first.
export const toast = {
  success: (content: ReactNode) => void message.success({ content, duration: 4 }),
  info: (content: ReactNode) => void message.info({ content, duration: 4 }),
  warning: (content: ReactNode) => void message.warning({ content, duration: 5 }),
  error: (content: ReactNode) => void message.error({ content, duration: 6 }),
  loading: (content: ReactNode, key: string) => void message.loading({ content, key, duration: 0 }),
  done: (content: ReactNode, key: string) => void message.success({ content, key, duration: 3 }),
};
