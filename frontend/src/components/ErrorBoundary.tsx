import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors so a single bad panel cannot blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Never log repository content; only the error and component stack.
    console.error('UI error boundary:', error.message, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="fatal">
          <div className="fatal__icon" aria-hidden="true">
            !
          </div>
          <h1>Something broke in the interface</h1>
          <p>
            The error was contained so the rest of the application could keep running. Reloading
            usually fixes it.
          </p>
          <pre className="fatal__detail">{this.state.error.message}</pre>
          <div className="fatal__actions">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload RepoVerse
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                this.setState({ error: null });
                window.location.assign('/');
              }}
            >
              Back to repositories
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
