/**
 * Dotted capability path -> implementation.
 *
 * capabilities.json declares what EXISTS; this declares what RUNS. They are
 * cross-checked at startup, so the two can never quietly disagree — see
 * capabilities.integrity().
 */
import { check } from './commands/check.mjs';
import { capabilities } from './commands/capabilities.mjs';
import { systemDoctor } from './commands/system.mjs';
import { qualityRunner } from './commands/quality.mjs';
import { secretsList } from './commands/secrets.mjs';
import { docsCheck } from './commands/docs.mjs';

export const HANDLERS = {
  'check': check,
  'capabilities': capabilities,
  'system.doctor': systemDoctor,
  'quality.lint': qualityRunner('quality.lint'),
  'quality.typecheck': qualityRunner('quality.typecheck'),
  'quality.unit': qualityRunner('quality.unit'),
  'secrets.list': secretsList,
  'docs.check': docsCheck,
};

export const HANDLER_PATHS = Object.keys(HANDLERS);
