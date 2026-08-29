/**
 * snapshot.mjs
 * ---------------------------------------------------------------------------
 * Which class gained a level between two moments.
 *
 * THIS FILE USED TO BE THE WHOLE LEVEL-UP REPORT. It took a full reading of a
 * character before and after - hit points, items, spell slots, skills, saves,
 * abilities, languages - and turned the difference into a list of sentences.
 * The reasoning behind it still holds and has simply moved: predicting what a
 * level ought to give would mean modelling the rules, and would be wrong for
 * anything homebrew, so we read the sheet twice and report the difference.
 *
 * What changed is who does it. gains.mjs was already reading the same sheet the
 * same way for the creation panel's cards, and drawing the result as pills with
 * the item's own description on hover. Two readings of one sheet, answering one
 * question, in two shapes - and the shape with the rules attached was the one a
 * player only ever saw during creation. So the level-up window draws the pills
 * now, and the reading behind them is gains.mjs.
 *
 * One thing that reading cannot say: it holds item names and numbers, and
 * "Barbarian 2 to 3" is neither - a class item is not gained when its level
 * goes up, only edited. That single sentence is what is left here, and it is
 * the heading over the pills rather than one of them.
 *
 * Deliberately dumb, as it always was: plain values, no document references, so
 * a reading stays valid after the documents it came from have changed.
 */

/** Class levels as they stand, plus the character's own level. */
export function takeSnapshot(actor) {
  if (!actor) return null;
  const system = actor.system ?? {};

  return {
    level: Number(system.details?.level ?? 0),
    classes: Object.fromEntries(
      Array.from(actor.items ?? [])
        .filter((i) => i.type === "class")
        .map((i) => [i.name, Number(i.system?.levels ?? 0)])
    )
  };
}

/**
 * Which class went up between two readings, as numbers rather than as a phrase.
 *
 * Numbers because the heading built from this is redrawn every time the footer's
 * language switch is used, and a stored "2 -> 3" would be fine while a stored
 * "Nowa klasa" would not - so nothing here is a sentence.
 *
 * The first class found is the answer: one press of the importer's button
 * levels one class, and a multiclass press adds exactly one new one.
 *
 * @returns {{name: string, from: number, to: number}|null}
 */
export function levelChange(before, after) {
  if (!before || !after) return null;

  for (const [name, level] of Object.entries(after.classes ?? {})) {
    const was = Number(before.classes?.[name] ?? 0);
    if (level > was) return { name, from: was, to: Number(level) };
  }
  return null;
}
