import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell configuration.
 *
 * The web build is unaffected by this file — it exists only for `cap sync`
 * and the native projects.
 */
const config: CapacitorConfig = {
  appId: 'com.play10q.app',
  appName: '10Q',

  // The static export. build-native.sh produces it; `cap sync` copies it into
  // the native projects.
  webDir: 'out',

  // Deliberately NO `server.url`.
  //
  // Pointing the WebView at https://play10q.com would be simpler and is what
  // most Capacitor tutorials show, but it makes the app a browser wrapper:
  // offline it is a blank screen, App Store Guideline 4.2 treats it as
  // minimum functionality, and every navigation is a network round trip.
  //
  // Assets are served from the bundle through WKURLSchemeHandler on iOS and
  // WebViewAssetLoader on Android. 0A proved this works with Next's export
  // router: GameProvider survived a client-side navigation between questions
  // (mountId and mountCount both unchanged), so the segment-cache HEAD probe
  // gets its 2xx and in-flight quiz state is not destroyed mid-attempt.
  // See docs/cross-platform/STATUS.md and ADR-001.

  // Schemes live under `server`, not the platform blocks. Both values are
  // already in the Edge Functions' CORS allow-list (_shared/cors.ts) — that
  // was 0D's whole point, and getting them wrong here means leagues and
  // profiles load while the quiz dies on every request.
  server: {
    // capacitor://localhost
    iosScheme: 'capacitor',
    // http://localhost. NOT a custom scheme: since WebView 117 Android cannot
    // change the URL path under one, which breaks Next's router outright.
    // https would need a certificate the asset loader cannot present.
    androidScheme: 'http',
  },

  ios: {
    // 'never', not 'always'. With 'always' the WKWebView applies the safe-area
    // inset itself — the native layer reserves the notch strip and starts the
    // web content below it, which renders as a black band across the top and
    // double-counts with the CSS env(safe-area-inset-*) padding the app
    // already applies.
    //
    // The app is edge-to-edge by design: the brand gradient should run under
    // the status bar, and ArcadeBackground's pt-safe-only keeps content clear
    // of the notch. So the web layer owns that space, not the WebView.
    contentInset: 'never',
  },

  plugins: {
    SplashScreen: {
      // The web app renders its own loading state, so a splash that lingers
      // just delays first paint. Short, then hand over.
      launchShowDuration: 500,
      launchAutoHide: true,
      backgroundColor: '#413DE1',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      // Brand purple behind the status bar, matching the themeColor in the
      // viewport export. Light content because the brand purple is dark.
      style: 'LIGHT',
      backgroundColor: '#413DE1',
      overlaysWebView: true,
    },
    Preferences: {
      // Namespaced so the session cannot collide with anything else the OS
      // stores for this bundle id.
      group: 'com.play10q.app',
    },
  },
};

export default config;
