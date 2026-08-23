/**
 * The platform seam — the contract between the app and the device it runs on.
 *
 * One source tree builds a web app, an iOS app and an Android app. Everything
 * that differs between them lives behind these interfaces, and nothing else in
 * the app may know which platform it is on.
 *
 * Two rules make that real, both enforced by ESLint rather than discipline:
 *
 *   1. No `@capacitor/*` import outside src/platform/.
 *   2. No `if (isNative)` in src/app/ or src/components/. A screen that needs
 *      to branch gets a capability instead.
 *
 * Every capability has a working web implementation, even where that is a
 * no-op (haptics) or a degraded fallback (clipboard instead of a share sheet).
 * Web is not a second-class target.
 */

/**
 * The result of reading durable storage.
 *
 * This distinction is the single highest-stakes thing in the seam, and it
 * exists because the obvious API cannot express it.
 *
 * `localStorage.getItem()` returns `null` both for "this key is empty" and for
 * "storage threw" — Safari private mode, a WebView evicting its cache, a
 * quota error. Today `ensureSession()` treats any unreadable session as "no
 * session" and calls `signInAnonymously()`. On web that is survivable. On a
 * custom-scheme origin it means **a storage hiccup mints a brand-new anonymous
 * user on cold start**, silently orphaning the previous account's streak,
 * history and leagues, with no error anyone sees.
 *
 * So: `ok: false` means "could not read". It must NEVER be treated as
 * "no session, create one". Minting an anonymous user requires a positive
 * `{ ok: true, value: null }` — storage is durable, and it is genuinely empty.
 */
export type StorageResult<T> =
  | { ok: true; value: T | null }
  | { ok: false; error: Error };

export interface Storage {
  /**
   * Read a key. Returns `ok: false` if storage could not be read at all —
   * never conflate that with an absent value.
   */
  get(key: string): Promise<StorageResult<string>>;
  set(key: string, value: string): Promise<StorageResult<void>>;
  remove(key: string): Promise<StorageResult<void>>;
  /**
   * Prove storage is durable and writable, by round-tripping a probe value.
   *
   * Gate irreversible decisions on this rather than on a read returning null.
   * A read that fails and a store that is empty look identical otherwise.
   */
  isDurable(): Promise<boolean>;
}

/** Where the Supabase session is persisted. Matches Supabase's storage shape. */
export interface SessionStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type OAuthProvider = 'google' | 'apple';

export interface OAuth {
  /**
   * Begin sign-in. On web this navigates away and never returns. On native it
   * opens a system browser (ASWebAuthenticationSession / Custom Tabs) — Google
   * returns `disallowed_useragent` inside an embedded WebView — and resolves
   * when the callback arrives via the custom scheme.
   */
  signIn(provider: OAuthProvider): Promise<void>;
  /**
   * Upgrade the current anonymous user in place. Uses linkIdentity so the user
   * id survives, which is what keeps streaks, scores and league membership
   * attached to the account across the upgrade.
   */
  link(provider: OAuthProvider): Promise<void>;
}

export interface Haptics {
  /** Light tap. A no-op on web. */
  impact(style?: 'light' | 'medium' | 'heavy'): Promise<void>;
  /** Answer feedback. A no-op on web. */
  notification(type: 'success' | 'warning' | 'error'): Promise<void>;
}

export interface Share {
  /**
   * Share text and a URL. Native gets the system share sheet; web falls back
   * through the Web Share API to copying the link.
   *
   * Resolves `false` if the user dismissed the sheet, so callers can avoid
   * claiming "copied!" when nothing happened.
   */
  share(options: { title?: string; text?: string; url: string }): Promise<boolean>;
}

export type AppStateListener = (state: 'active' | 'background') => void;
export type NetworkListener = (online: boolean) => void;

export interface Lifecycle {
  /**
   * Foreground and background transitions.
   *
   * Missing entirely today, and the game is server-timed: a player who
   * backgrounds mid-question comes back to a countdown that kept running.
   * The client cannot be trusted with that, so the app must re-sync on
   * resume rather than assume its local clock is still right.
   */
  onAppStateChange(listener: AppStateListener): () => void;
  onNetworkChange(listener: NetworkListener): () => void;
  isOnline(): Promise<boolean>;
}

export interface Navigation {
  /**
   * Android's hardware back button. Return `true` to consume the event.
   * A no-op returning an unsubscribe on web.
   */
  onBack(handler: () => boolean): () => void;
  /** Deep links that opened or resumed the app. */
  onDeepLink(handler: (url: string) => void): () => void;
}

export interface AppInfo {
  platform: 'web' | 'ios' | 'android';
  version: string;
  build: string;
  /** True for iOS and Android builds. Only the seam should ever branch on it. */
  isNative: boolean;
}

export type PushPermission = 'granted' | 'denied' | 'prompt';

export interface PushNotifications {
  /**
   * What the OS currently thinks, without asking.
   *
   * Checked before priming so a player who already granted or denied is not
   * shown a prompt about a prompt.
   */
  checkPermission(): Promise<PushPermission>;

  /**
   * Ask the OS, then register with APNs/FCM and hand the token to the server.
   *
   * Resolves to the granted state. Calling this when already denied does
   * nothing on iOS — the OS will not re-prompt, and the player has to go to
   * Settings — so callers should check first and say so rather than
   * appearing to do nothing.
   */
  requestPermissionAndRegister(): Promise<PushPermission>;

  /** Stop delivery to this device. Used on sign-out. */
  unregister(): Promise<void>;

  /**
   * A notification was tapped. The handler receives the `data` payload the
   * server sent, which carries the route to open.
   */
  onNotificationTap(handler: (data: Record<string, string>) => void): () => void;
}
