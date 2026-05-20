/**
 * Minimal error boundary. Used to isolate the chat drawer / floating button
 * so a render error in them can't blank the rest of the dashboard.
 */

import React from 'react';

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface the error in the console (visible in DevTools) without
    // swallowing it. The user asked for no silent failure.
    console.error('[ErrorBoundary] caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="fixed bottom-6 right-6 z-40 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            Component error: {this.state.error.message}
          </div>
        )
      );
    }
    return this.props.children;
  }
}
