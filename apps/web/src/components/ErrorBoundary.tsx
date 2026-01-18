'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ArcadeBackground } from './ArcadeBackground';
import { logger } from '@/lib/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error({
      event: 'ERROR',
      scope: 'ui',
      error_name: error.name,
      error_message: error.message,
      stack: error.stack,
      component_stack: errorInfo.componentStack,
      user_outcome: 'error_boundary_caught',
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ArcadeBackground>
          <div className="flex items-center justify-center min-h-screen px-4">
            <div className="bg-paper border-[4px] border-ink rounded-[24px] shadow-sticker p-8 w-full max-w-md text-center">
              <h1 className="font-display text-2xl mb-4 text-ink">Something Went Wrong</h1>
              <p className="font-body font-bold text-lg mb-6 text-ink">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <div className="space-y-3">
                <button
                  onClick={this.handleReset}
                  className="w-full h-12 bg-cyanA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
                >
                  Try Again
                </button>
                <button
                  onClick={() => window.location.href = '/'}
                  className="w-full h-12 bg-paper border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
                >
                  Go Home
                </button>
                {process.env.NODE_ENV === 'development' && (
                  <button
                    onClick={async () => {
                      try {
                        await logger.copyDiagnosticBundleToClipboard();
                        alert('Debug bundle copied to clipboard!');
                      } catch (err) {
                        console.error('Failed to copy bundle:', err);
                      }
                    }}
                    className="w-full h-12 bg-yellowA border-[3px] border-ink rounded-lg shadow-sticker-sm font-bold text-sm text-ink transition-transform duration-[120ms] ease-out active:translate-x-[1px] active:translate-y-[1px]"
                  >
                    Copy Debug Bundle
                  </button>
                )}
              </div>
            </div>
          </div>
        </ArcadeBackground>
      );
    }

    return this.props.children;
  }
}

