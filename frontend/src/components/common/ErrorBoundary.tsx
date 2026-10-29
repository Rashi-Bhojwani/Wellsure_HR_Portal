import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../../theme/tokens";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled UI error", error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null });

  private reload = (): void => window.location.reload();

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: v.bgPage, padding: space[4] }}>
          {/* Self-contained (no EmptyState/Typography): this sits in the entry chunk, which the login screen's bundle budget has to carry. */}
          <div role="alert" style={{ maxWidth: 440, textAlign: "center", background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: `${space[8]}px ${space[6]}px` }}>
            <span
              aria-hidden
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 56, height: 56, borderRadius: radius.pill, background: v.dangerSubtle, color: v.danger, fontSize: fs.h1, fontWeight: fw.bold, marginBottom: space[4] }}
            >
              !
            </span>
            <h1 style={{ margin: 0, fontSize: fs.xl, fontWeight: fw.bold, color: v.textPrimary }}>Something went wrong</h1>
            <p style={{ margin: `${space[2]}px 0 ${space[6]}px`, fontSize: fs.md, lineHeight: 1.6, color: v.textSecondary, overflowWrap: "anywhere" }}>{this.state.error.message}</p>
            <div style={{ display: "flex", gap: space[3], justifyContent: "center", flexWrap: "wrap" }}>
              <Button onClick={this.reset}>Try again</Button>
              <Button type="primary" icon={<ReloadOutlined />} onClick={this.reload}>
                Reload
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
