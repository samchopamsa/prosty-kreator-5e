/**
 * trace.mjs
 * ---------------------------------------------------------------------------
 * The diagnostic log line, on its own.
 *
 * It lives apart from debug.mjs because debug.mjs reads from the watchers and
 * the watchers want to log - which is a cycle. ES modules survive one, but a
 * cycle that works only because function declarations are hoisted is a trap for
 * whoever edits it next. This file imports nothing but the module id, so
 * anything may import it.
 */

import { MODULE_ID } from "./constants.mjs";

/** Whether to log as things happen, rather than only when asked. */
export function isDebug() {
  try {
    return !!game.settings.get(MODULE_ID, "debug");
  } catch (err) {
    // Called before settings are registered, which is not worth a warning.
    return false;
  }
}

/** A log line that costs nothing when diagnostics are off. */
export function trace(...args) {
  if (isDebug()) console.log(`%c${MODULE_ID}`, "color:#7fb069", ...args);
}
