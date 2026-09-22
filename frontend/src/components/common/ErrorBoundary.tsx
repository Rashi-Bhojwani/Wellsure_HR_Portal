import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Result } from "antd";

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

  render(): ReactNode {
    if (this.state.error) {
      return (
        <Result
          status="error"
          title="Something went wrong"
          subTitle={this.state.error.message}
          extra={
            <Button type="primary" onClick={this.reset}>
              Try again
            </Button>
          }
        />
      );
    }

    return this.props.children;
  }
}
