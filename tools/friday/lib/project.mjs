/**
 * Facts about THIS repository that Friday operates against.
 *
 * WHY THIS IS SOURCE AND NOT A CONFIG FILE
 *
 * Sonnet's Friday reads a `friday.yml` because it genuinely needs configuring:
 * workspace and scheme names, test destinations, build configurations, isolated
 * DerivedData paths, release settings. That is a real cluster of repo facts.
 *
 * 10Q has almost none of that yet. A config file holding `{"name": "10Q"}` is
 * ceremony, not configuration — and YAML specifically would cost a dependency,
 * which is the one thing that would break the freshness guarantee (see
 * freshness.mjs). So the handful of facts live here, hardcoded, until there are
 * enough of them to justify a file.
 *
 * WHEN TO PROMOTE THIS TO tools/friday/config.json
 *
 * When the release work lands and this grows a real cluster — Cloudflare
 * project, Apple bundle id, Xcode project and scheme, Android application id,
 * GitHub workflow names, release branch and tag conventions — move it to JSON
 * (parsed natively, never YAML) under this rule:
 *
 *   friday.json holds declarative, non-secret, relatively stable facts about
 *   how Friday operates this repository. It holds neither credentials nor
 *   mutable deployment or release state.
 *
 * Guard that rule. Friday already keeps five distinct kinds of data apart —
 * capabilities.json (what Friday can do), supabase/refs.json (which project is
 * which), this (how Friday operates the repo), release state, and credentials
 * in the Keychain or CI. A general config file is exactly where those five
 * quietly become one junk drawer.
 */

export const PROJECT = {
  name: '10Q',

  // Named "web" for historical reasons; it feeds web, iOS and Android. See CLAUDE.md.
  clientWorkspace: 'apps/web',

  // Which Supabase project is which. Data, not config — CI reads it too.
  refsFile: 'supabase/refs.json',
};
