import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Status-bar setup for the native shell.
 *
 * The `StatusBar` block in capacitor.config.ts is NOT applied automatically —
 * it only supplies defaults for these calls. Without invoking them, iOS
 * reserves the status-bar strip and paints it black, which is the band across
 * the top of the app.
 *
 * `setOverlaysWebView(true)` hands that strip to the WebView so the brand
 * gradient runs edge to edge. That is also what makes
 * `env(safe-area-inset-top)` meaningful — the padding the app already applies
 * then keeps content clear of the notch, rather than the OS reserving space
 * with a colour the app does not control.
 *
 * Failures are swallowed. A wrong status-bar colour is cosmetic; it must
 * never stop the app from starting.
 */
export async function configureStatusBar(): Promise<void> {
  try {
    await StatusBar.setOverlaysWebView({ overlay: true });
    // Light glyphs: the brand purple behind them is dark.
    await StatusBar.setStyle({ style: Style.Light });
  } catch {
    /* not available (web, or an OS that refuses) — cosmetic only */
  }
}
