/**
 * migrate.mjs
 * ---------------------------------------------------------------------------
 * Keeps the flags this module writes on an actor readable as their shape
 * changes.
 *
 * There are five of them now - abilities, languages, guideDismissed,
 * disclaimerSeen, skippedOptions - and no way to tell an old one from a new
 * one. The first time any of them needs a different shape, every character made
 * before that day would be read wrongly, and the failure would be quiet: a
 * warning that does not appear, an ability bonus counted twice.
 *
 * So each actor carries a schema number, and a migration is a function that
 * takes it from N to N+1. Cheap while there is nothing to migrate; the point is
 * that the hook exists before it is needed rather than after.
 *
 * ADDING A MIGRATION
 *   1. Write the function, from the old shape to the new one.
 *   2. Push it onto MIGRATIONS - position 0 goes from schema 0 to 1, and so on.
 *   3. Raise SCHEMA to match.
 * Do not renumber or remove entries: someone's character is still at that
 * version and needs every step from where they are to here.
 */

import { MODULE_ID } from "./constants.mjs";

/** Current shape of this module's flags. */
export const SCHEMA = 1;

export const SCHEMA_FLAG = "schema";

/**
 * One entry per step. MIGRATIONS[0] takes schema 0 to schema 1.
 *
 * Each receives the module's flags as a plain object and returns the changed
 * ones, or null when there is nothing to do. It must not touch the actor
 * itself: the caller writes everything in one update.
 */
export const MIGRATIONS = [
  // 0 -> 1: the first numbered version. Characters made before schema numbers
  // existed are already in this shape, so there is nothing to change - this
  // entry only marks where counting began.
  () => null
];

/**
 * Brings one actor up to the current schema.
 *
 * @returns {object|null} What changed, or null if it was already current.
 */
export function planMigration(flags = {}, from = null) {
  const current = Number.isInteger(from) ? from : Number(flags[SCHEMA_FLAG] ?? 0);
  if (current >= SCHEMA) return null;

  let working = { ...flags };
  let changed = false;

  for (let version = current; version < SCHEMA; version += 1) {
    const step = MIGRATIONS[version];
    if (typeof step !== "function") continue;
    const result = step(working);
    if (result) {
      working = { ...working, ...result };
      changed = true;
    }
  }

  return { ...(changed ? working : {}), [SCHEMA_FLAG]: SCHEMA };
}

/**
 * Runs any outstanding migration, once, when the guide opens the character.
 *
 * Only for characters this module has actually written to. An actor with none
 * of our flags is not ours to stamp, and marking it would be a lie about what
 * has been checked.
 */
export async function migrateActor(actor) {
  if (!actor) return false;

  const flags = actor.flags?.[MODULE_ID] ?? {};
  const ours = Object.keys(flags).filter((key) => key !== SCHEMA_FLAG);
  if (!ours.length) return false;

  const changes = planMigration(flags);
  if (!changes) return false;

  try {
    await actor.update({ [`flags.${MODULE_ID}`]: changes });
    console.log(`${MODULE_ID} | ${actor.name}: flags brought up to schema ${SCHEMA}`);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not migrate flags on ${actor.name}`, err);
    return false;
  }
}
