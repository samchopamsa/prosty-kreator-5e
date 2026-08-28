/**
 * abilities-core.mjs
 * ---------------------------------------------------------------------------
 * Ability scores: the arithmetic, with no window around it.
 *
 * All of this used to live inside CompleteCharacter, which was fine while the
 * only way to set ability scores was that popup. The guide panel now offers the
 * same choice inline on its own step, and point buy costed twice - once here and
 * once there - is exactly the kind of second source of truth this module spends
 * its effort avoiding. So the state, the sums and the write live here, and both
 * screens are drawing surfaces over them.
 *
 * A state is a plain object: { method, pool, assign, direct }. Nothing in here
 * touches a document except applyAbilities(), which is the one place a score is
 * written.
 *
 * IMPORTANT, and the reason existingBonus() is as careful as it is: a
 * background's ability score increase is written straight into
 * system.abilities.X.value, not kept as a separate bonus. Overwriting the score
 * would silently destroy it, so whatever is already there has to be found first
 * and added underneath the player's assignment.
 */

import { MODULE_ID } from "./constants.mjs";

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_TOTAL = 27;

/** The system's ability list, with the 5e set as a fallback. */
export function abilityKeys() {
  return Object.keys(
    CONFIG.DND5E?.abilities ?? { str: {}, dex: {}, con: {}, int: {}, wis: {}, cha: {} }
  );
}

/** A fresh, unassigned state on the standard array. */
export function newState() {
  const state = { method: "standard", pool: [...STANDARD_ARRAY], assign: {}, direct: {} };
  for (const key of abilityKeys()) {
    state.assign[key] = null;
    state.direct[key] = 8;
  }
  return state;
}

/** What this module saved on its last run for this actor, or null. */
export function savedState(actor) {
  return actor?.getFlag(MODULE_ID, "abilities") ?? null;
}

/**
 * A state seeded from the actor's flag, so coming back to the step shows what
 * was chosen. A fresh state when the character has never been through this.
 */
export function stateFor(actor) {
  const state = newState();
  const saved = savedState(actor);
  if (!saved) return state;

  if (saved.method) state.method = saved.method;
  if (Array.isArray(saved.pool) && saved.pool.length) state.pool = [...saved.pool];
  for (const key of abilityKeys()) {
    if (saved.assign) state.assign[key] = saved.assign[key] ?? null;
    if (saved.direct) state.direct[key] = saved.direct[key] ?? 8;
  }
  return state;
}

/**
 * Ability increases already applied to the sheet.
 *
 * Read from the actual AbilityScoreImprovement advancements on the character's
 * items. Falling back to "anything above 10 is a bonus" was wrong for sheets
 * that already had proper scores - it treated 15 as a +5 increase.
 */
export function detectBonuses(actor) {
  const result = { values: {}, source: "none" };
  if (!actor) return result;

  for (const item of actor.items) {
    for (const adv of item.system?.advancement ?? []) {
      if (adv.type !== "AbilityScoreImprovement") continue;
      const value = adv.value ?? {};
      const assignments = value.assignments ?? value.abilities ?? {};
      for (const [key, raw] of Object.entries(assignments)) {
        const amount = Number(raw);
        if (Number.isFinite(amount) && amount > 0) {
          result.values[key] = (result.values[key] ?? 0) + amount;
        }
      }
    }
  }

  if (Object.keys(result.values).length) result.source = "advancement";
  return result;
}

/**
 * The bonus already on the sheet, by decreasing reliability:
 *
 * 1. If this ran before, the difference between the current score and the base
 *    we wrote IS the bonus. Exact, and it picks up later increases.
 * 2. Otherwise, the ability score improvements declared on the actor's items.
 * 3. Otherwise, the old guess: anything above 10.
 */
export function existingBonus(actor, key, bonusMode, bonuses = detectBonuses(actor)) {
  if (!actor || bonusMode === "none") return 0;

  // Reading straight from the advancements ignores whatever is currently on the
  // sheet. That is the point: increases left behind by an importer when an item
  // was deleted quietly inflate the scores, and measuring against the sheet
  // would faithfully preserve that inflation.
  if (bonusMode === "advancements") return bonuses.values[key] ?? 0;

  const current = actor.system?.abilities?.[key]?.value ?? 10;
  const lastBase = savedState(actor)?.base?.[key];
  if (Number.isFinite(lastBase)) return Math.max(0, current - lastBase);

  if (bonuses.source === "advancement") return bonuses.values[key] ?? 0;

  return Math.max(0, current - 10);
}

export function baseValue(state, key) {
  if (state.method === "standard" || state.method === "roll") {
    const idx = state.assign[key];
    return idx === null || idx === undefined ? null : state.pool[idx];
  }
  return Number(state.direct[key]) || 0;
}

export function pointsSpent(state) {
  return abilityKeys().reduce((sum, k) => sum + (POINT_BUY_COST[state.direct[k]] ?? 0), 0);
}

export function isReady(state, actor) {
  if (!actor) return false;
  if (state.method === "standard" || state.method === "roll") {
    return abilityKeys().every((k) => state.assign[k] !== null);
  }
  if (state.method === "pointbuy") return pointsSpent(state) <= POINT_BUY_TOTAL;
  return abilityKeys().every((k) => {
    const v = Number(state.direct[k]);
    return Number.isFinite(v) && v >= 1 && v <= 20;
  });
}

/**
 * Switching method clears the pool assignment.
 *
 * Here rather than in either screen: the popup and the panel's inline step draw
 * the same state, so they have to agree on what changing a radio button means.
 */
export function setMethod(state, method) {
  state.method = method;
  if (method === "standard") state.pool = [...STANDARD_ARRAY];
  for (const key of abilityKeys()) state.assign[key] = null;
}

/** One press of the stepper, clamped to whatever the method allows. */
export function stepAbility(state, key, delta) {
  const max = state.method === "pointbuy" ? 15 : 20;
  const min = state.method === "pointbuy" ? 8 : 1;
  const next = (state.direct[key] ?? 8) + delta;
  if (next >= min && next <= max) state.direct[key] = next;
}

/** One row per ability, ready to render: the sum shown before anything is saved. */
export function buildRows(actor, state, bonusMode) {
  const used = new Set(Object.values(state.assign).filter((v) => v !== null));
  const bonuses = detectBonuses(actor);

  return abilityKeys().map((key) => {
    const cfg = CONFIG.DND5E?.abilities?.[key] ?? {};
    const base = baseValue(state, key);
    const bonus = existingBonus(actor, key, bonusMode, bonuses);
    const final = base === null ? null : Math.min(20, base + bonus);
    const mod = final === null ? null : Math.floor((final - 10) / 2);
    return {
      key,
      label: cfg.label ?? key.toUpperCase(),
      current: actor?.system?.abilities?.[key]?.value ?? "—",
      base,
      bonus,
      bonusLabel: bonus ? `+${bonus}` : "—",
      final: final ?? "—",
      modLabel: mod === null ? "—" : mod >= 0 ? `+${mod}` : `${mod}`,
      options: state.pool.map((v, i) => ({
        index: i,
        value: v,
        selected: state.assign[key] === i,
        disabled: used.has(i) && state.assign[key] !== i
      })),
      minusDisabled: state.method === "pointbuy" ? state.direct[key] <= 8 : state.direct[key] <= 1,
      plusDisabled: state.method === "pointbuy" ? state.direct[key] >= 15 : state.direct[key] >= 20,
      value: state.direct[key]
    };
  });
}

/** Six rolls of 4d6 drop lowest, sorted high to low. */
export async function rollPool() {
  const values = [];
  for (let i = 0; i < 6; i++) {
    const roll = await new Roll("4d6dl1").evaluate();
    values.push(roll.total);
  }
  return values.sort((a, b) => b - a);
}

/**
 * Writes the scores, then tops the character up.
 *
 * Constitution may have changed, so maximum hit points are only correct after
 * the first update has been applied - hence the second one.
 *
 * Returns true when something was written, false when the state is not ready.
 */
export async function applyAbilities(actor, state, bonusMode) {
  if (!actor || !isReady(state, actor)) return false;

  const update = {};
  const base = {};
  const bonuses = detectBonuses(actor);
  for (const key of abilityKeys()) {
    const value = baseValue(state, key);
    if (value === null) continue;
    base[key] = value;
    update[`system.abilities.${key}.value`] = Math.min(
      20,
      value + existingBonus(actor, key, bonusMode, bonuses)
    );
  }
  // Remember the base scores we wrote. Next time the bonus is derived from the
  // difference against these, so nothing is ever counted twice.
  update[`flags.${MODULE_ID}.abilities`] = {
    method: state.method,
    pool: [...state.pool],
    assign: { ...state.assign },
    direct: { ...state.direct },
    base,
    appliedAt: Date.now()
  };

  await actor.update(update);

  const max = Number(actor.system?.attributes?.hp?.max ?? 0);
  const value = Number(actor.system?.attributes?.hp?.value ?? 0);
  if (max > 0 && value < max) {
    await actor.update({ "system.attributes.hp.value": max });
  }
  return true;
}
