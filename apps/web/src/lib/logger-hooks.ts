/**
 * React hooks for logger integration
 */

import { useEffect, useState } from 'react';
import { logger, type LogEntry } from './logger';

/**
 * Hook to get diagnostic bundle and copy functionality
 */
export function useDiagnosticBundle() {
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const bundle = logger.getDiagnosticBundle();
    setBundleId(bundle.bundleId);
  }, []);

  const copyToClipboard = async () => {
    try {
      await logger.copyDiagnosticBundleToClipboard();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy diagnostic bundle:', error);
    }
  };

  return {
    bundleId,
    copyToClipboard,
    copied,
  };
}

/**
 * Hook to log route changes
 */
export function useRouteLogging() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const logRouteChange = () => {
      logger.info({
        event: 'ROUTE_CHANGED',
        scope: 'ui',
        route_path: window.location.pathname,
        route_search: window.location.search,
      });
    };

    // Log initial route
    logRouteChange();

    // Listen for popstate (back/forward navigation)
    window.addEventListener('popstate', logRouteChange);

    return () => {
      window.removeEventListener('popstate', logRouteChange);
    };
  }, []);
}

/**
 * Hook to log view load timing
 */
export function useViewLoadLogging(viewName: string) {
  useEffect(() => {
    const startTime = performance.now();

    const logViewLoad = () => {
      const renderTime = Math.round(performance.now() - startTime);
      logger.info({
        event: 'VIEW_LOADED',
        scope: 'ui',
        view_name: viewName,
        render_time_ms: renderTime,
      });
    };

    // Log after first paint
    if (document.readyState === 'complete') {
      logViewLoad();
    } else {
      window.addEventListener('load', logViewLoad, { once: true });
    }
  }, [viewName]);
}
