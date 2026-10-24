import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { EmptyState } from "../../ui";
import { space, v } from "../../theme/tokens";

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
          <EmptyState
            kind="error"
            title="Something went wrong"
            description={this.state.error.message}
            action={
              <>
                <Button onClick={this.reset}>Try again</Button>
                <Button type="primary" icon={<ReloadOutlined />} onClick={this.reload}>
                  Reload
                </Button>
              </>
            }
          />
        </div>
      );
    }

    return this.props.children;
  }
}
