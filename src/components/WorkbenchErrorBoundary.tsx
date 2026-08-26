import { Component, type ErrorInfo, type ReactNode } from "react";
import "./workbenchErrorBoundary.css";

type WorkbenchErrorBoundaryProps = {
  children: ReactNode;
};

type WorkbenchErrorBoundaryState = {
  failed: boolean;
};

export class WorkbenchErrorBoundary extends Component<
  WorkbenchErrorBoundaryProps,
  WorkbenchErrorBoundaryState
> {
  state: WorkbenchErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): WorkbenchErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Syndrid Desktop render failure", error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="workbench-error" role="alert">
        <section className="workbench-error-card">
          <span className="workbench-error-kicker">Workbench recovery</span>
          <h1>Syndrid Desktop hit a display error.</h1>
          <p>
            The visual client stopped rendering to avoid leaving partially updated controls on
            screen. SyndridCLI remains the runtime authority.
          </p>
          <button onClick={this.reload} type="button">
            Reload Desktop
          </button>
        </section>
      </main>
    );
  }
}
