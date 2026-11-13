"use client";

/**
 * Catches render failures in one dashboard section without taking the page
 * down. A component that throws while drawing the plan card must not cost the
 * reader their repository history.
 *
 * Deliberately a class: `componentDidCatch` has no hook equivalent.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** What failed, in the product's words — "Your repository history". */
  subject?: string;
  /** Replaces the default panel, for a section with its own framing. */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console only: the reader gets the sentence below, we get the stack.
    console.error(
      `Dashboard section failed: ${this.props.subject ?? "unknown"}`,
      error,
      info.componentStack,
    );
  }

  private reload = () => window.location.reload();

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="db-win" role="alert">
        <div className="db-fail">
          <p className="db-fail__t">
            {this.props.subject ?? "This section"} couldn&apos;t be displayed.
          </p>
          <p className="db-fail__b">
            Something went wrong while drawing it. Reloading usually clears it.
          </p>
          <button type="button" className="db-sbtn" onClick={this.reload}>
            <RotateCw size={13} aria-hidden />
            Reload
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
