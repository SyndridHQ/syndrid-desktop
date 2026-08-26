import { Component, type ErrorInfo, type ReactNode } from "react";
import { appServerClient } from "../runtime/appServerClient";
import "./workbenchErrorBoundary.css";

type WorkbenchErrorBoundaryProps = {
  children: ReactNode;
};

type WorkbenchErrorBoundaryState = {
  failed: boolean;
  recovering: boolean;
};

export class WorkbenchErrorBoundary extends Component<
  WorkbenchErrorBoundaryProps,
  WorkbenchErrorBoundaryState
> {
  state: WorkbenchErrorBoundaryState = { failed: false, recovering: false };

  static getDerivedStateFromError(): WorkbenchErrorBoundaryState {
    return { failed: true, recovering: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Syndrid Desktop render failure", error, info.componentStack);
  }

  private reload = async (): Promise<void> => {
    if (this.state.recovering) return;
    this.setState({ recovering: true });
    try {
      await appServerClient.disconnect();
    } catch (error) {
      console.error("Syndrid Desktop recovery disconnect failed", error);
    } finally {
      window.location.reload();
    }
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
          <button
            disabled={this.state.recovering}
            onClick={() => void this.reload()}
            type="button"
          >
            {this.state.recovering ? "Restarting…" : "Reload Desktop"}
          </button>
        </section>
      </main>
    );
  }
}
