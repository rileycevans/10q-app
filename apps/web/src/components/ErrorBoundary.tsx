'use client';

import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cyanA to-magentaA p-4">
          <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 max-w-md text-center">
            <h1 className="font-display text-2xl font-bold text-ink mb-4">
              Oops! Something went wrong
            </h1>
            <p className="font-body text-ink/80 mb-6">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="h-12 px-6 bg-cyanA border-[3px] border-ink rounded-[14px] shadow-sticker-sm font-bold text-ink"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
