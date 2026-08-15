/**
 * snapshot.mjs
 * ---------------------------------------------------------------------------
 * What changed on a character between two moments.
 *
 * Levelling up in Foundry is oddly silent: the player clicks through several
 * windows and ends up back at a sheet that is different in ways nobody lists.
 * Working out what you gained means remembering what you had.
 *
 * So instead of predicting what a level ought to give - which would mean
 * modelling the rules, and would be wrong for anything homebrew - we take a
 * reading before and after, and report the difference. Whatever actually
 * happened is what gets shown, including things no rulebook would explain.
 *
 * takeSnapshot() is deliberately dumb: plain values, no document references, so
 * a snapshot stays valid after the documents it came from have changed.
 */

/** A reading of everything worth comparing. */
export function takeSnapshot(actor) {
  if (!actor) return null;
  const system = actor.system ?? {};

  return {
    level: Number(system.details?.level ?? 0),
    hp: Number(system.attributes?.hp?.max ?? 0),
    // Item names rather than ids: a feature re-granted at a higher level gets a
    // new id but is not new to the player.
    items: Array.from(actor.items ?? []).map((i) => `${i.type}:${i.name}`),
    classes: Object.fromEntries(
      Array.from(actor.items ?? [])
        .filter((i) => i.type === "class")
        .map((i) => [i.name, Number(i.system?.levels ?? 0)])
    ),
    spellSlots: Object.fromEntries(
      Object.entries(system.spells ?? {}).map(([key, slot]) => [key, Number(slot?.max) || 0])
    ),
    skills: Object.entries(system.skills ?? {})
      .filter(([, skill]) => Number(skill?.value) > 0)
      .map(([key]) => key),
    abilities: Object.fromEntries(
      Object.entries(system.abilities ?? {}).map(([key, a]) => [key, Number(a?.value ?? 0)])
    ),
    saves: Object.entries(system.abilities ?? {})
      .filter(([, a]) => Number(a?.proficient) > 0)
      .map(([key]) => key),
    languages: Array.from(system.traits?.languages?.value ?? [])
  };
}

/** Names of items in `after` that were not in `before`, counted properly. */
function addedItems(before, after) {
  const remaining = [...before];
  const gained = [];
  for (const entry of after) {
    const at = remaining.indexOf(entry);
    // Two copies of the same feature means one of them is new; matching by
    // value alone would hide the second.
    if (at >= 0) remaining.splice(at, 1);
    else gained.push(entry);
  }
  return gained;
}

/**
 * The difference between two snapshots, as a list of things to show a player.
 *
 * Each entry is { kind, label, detail }. Nothing is included that did not
 * change: a level-up that granted only hit points should say only that, rather
 * than reciting everything the character already had.
 */
export function compareSnapshots(before, after) {
  if (!before || !after) return [];
  const changes = [];

  for (const [name, level] of Object.entries(after.classes)) {
    const was = before.classes[name] ?? 0;
    if (level > was) {
      changes.push({
        kind: was === 0 ? "newClass" : "level",
        label: name,
        detail: was === 0 ? String(level) : `${was} \u2192 ${level}`
      });
    }
  }

  if (after.hp !== before.hp) {
    changes.push({ kind: "hp", label: "hp", detail: signed(after.hp - before.hp) });
  }

  const gained = addedItems(before.items, after.items);
  for (const entry of gained) {
    const [type, ...rest] = entry.split(":");
    const name = rest.join(":");
    // Classes and subclasses are already reported as a level change above.
    if (type === "class") continue;
    changes.push({ kind: type === "spell" ? "spell" : "item", label: name, detail: "" });
  }

  for (const [key, max] of Object.entries(after.spellSlots)) {
    const was = before.spellSlots[key] ?? 0;
    if (max > was) {
      changes.push({ kind: "slots", label: key, detail: `${was} \u2192 ${max}` });
    }
  }

  for (const key of after.skills) {
    if (!before.skills.includes(key)) changes.push({ kind: "skill", label: key, detail: "" });
  }

  for (const key of after.saves) {
    if (!before.saves.includes(key)) changes.push({ kind: "save", label: key, detail: "" });
  }

  for (const [key, value] of Object.entries(after.abilities)) {
    const was = before.abilities[key] ?? 0;
    if (value !== was) {
      changes.push({ kind: "ability", label: key, detail: `${was} \u2192 ${value}` });
    }
  }

  for (const key of after.languages) {
    if (!before.languages.includes(key)) changes.push({ kind: "language", label: key, detail: "" });
  }

  return changes;
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}
