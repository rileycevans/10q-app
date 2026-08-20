/**
 * The platform seam.
 *
 * Import capabilities from here, never from a `.web` or `.native` module
 * directly:
 *
 *     import { storage, haptics } from '@/platform';
 *
 * Selection happens once, at module load, driven by the build target rather
 * than by runtime sniffing. That matters for more than tidiness: using
 * `Capacitor.isNativePlatform()` would pull `@capacitor/*` into the web
 * bundle's dependency graph, shipping native code to browsers that can never
 * run it.
 *
 * NEXT_PUBLIC_CLIENT_PLATFORM is inlined by the bundler, so the unused branch
 * is statically eliminated and only one implementation reaches each build.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AppInfo,
  Haptics,
  Lifecycle,
  Navigation,
  OAuth,
  Share,
  Storage,
} from './types';

export * from './types';

const NATIVE = process.env.NEXT_PUBLIC_CLIENT_PLATFORM !== 'web';

export const storage: Storage = NATIVE
  ? require('./storage.native').default
  : require('./storage.web').default;

export const haptics: Haptics = NATIVE
  ? require('./haptics.native').default
  : require('./haptics.web').default;

export const share: Share = NATIVE
  ? require('./share.native').default
  : require('./share.web').default;

export const lifecycle: Lifecycle = NATIVE
  ? require('./lifecycle.native').default
  : require('./lifecycle.web').default;

export const navigation: Navigation = NATIVE
  ? require('./navigation.native').default
  : require('./navigation.web').default;

export const appInfo: AppInfo = NATIVE
  ? require('./appInfo.native').default
  : require('./appInfo.web').default;

export const oauth: OAuth = NATIVE
  ? require('./oauth.native').default
  : require('./oauth.web').default;

/**
 * Typed explicitly. Without the annotation this infers as `any` through
 * require(), which silently strips inference from every consumer —
 * onAuthStateChange callbacks lose their parameter types, and a typo in
 * `.auth.getUser()` stops being a compile error.
 */
export const supabase: SupabaseClient = NATIVE
  ? require('./session.native').default
  : require('./session.web').default;
