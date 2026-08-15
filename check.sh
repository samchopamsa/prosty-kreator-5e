#!/usr/bin/env bash
#
# check.sh - everything worth checking before pushing.
#
# These are the same checks that were being run by hand after every change, in
# the same order, and forgotten often enough to be worth writing down.
#
#   ./check.sh
#
# Needs node and nothing else. Exits non-zero on the first real problem, so it
# can go in front of a push.

set -u
cd "$(dirname "$0")"

fail=0
step() { printf '\n%s\n' "$1"; }
ok()   { printf '  ok   %s\n' "$1"; }
bad()  { printf '  FAIL %s\n' "$1"; fail=1; }

# --- 1. syntax -------------------------------------------------------------

step "syntax"
for f in scripts/*.mjs tests/*.mjs; do
  if node --check "$f" 2>/dev/null; then ok "$f"; else bad "$f"; node --check "$f"; fi
done

if node -e 'JSON.parse(require("fs").readFileSync("module.json","utf8"))' 2>/dev/null; then
  ok "module.json"
else
  bad "module.json is not valid JSON"
fi

# --- 2. templates ----------------------------------------------------------
#
# Handlebars is not a dependency of the module, so this only runs when it
# happens to be available. A missing compiler is not a failure.

step "templates"

# Handlebars is not a dependency of the module, so a real compile only happens
# where it is installed. Everywhere else we still check the thing that actually
# breaks when editing a template by hand: block helpers left unclosed.
if node -e 'require("handlebars")' 2>/dev/null; then
  node -e '
    const H = require("handlebars"), fs = require("fs");
    let bad = 0;
    for (const f of fs.readdirSync("templates")) {
      try { H.precompile(fs.readFileSync("templates/" + f, "utf8")); console.log("  ok   " + f + " (compiled)"); }
      catch (e) { console.log("  FAIL " + f + ": " + e.message); bad = 1; }
    }
    process.exit(bad);
  ' || fail=1
else
  node -e '
    const fs = require("fs");
    let bad = 0;
    for (const f of fs.readdirSync("templates")) {
      const src = fs.readFileSync("templates/" + f, "utf8");
      const stack = [];
      // {{#if}} {{#each}} {{#unless}} ... and their closers. {{else}} is not a
      // block of its own and must sit inside one.
      for (const m of src.matchAll(/\{\{([#/])(\w+)/g)) {
        if (m[1] === "#") stack.push(m[2]);
        else {
          const open = stack.pop();
          if (open !== m[2]) {
            console.log("  FAIL " + f + ": {{/" + m[2] + "}} closes {{#" + (open ?? "nothing") + "}}");
            bad = 1;
          }
        }
      }
      if (stack.length) {
        console.log("  FAIL " + f + ": unclosed {{#" + stack.join("}}, {{#") + "}}");
        bad = 1;
      } else if (!bad) {
        console.log("  ok   " + f + " (blocks balanced)");
      }
    }
    process.exit(bad);
  ' || fail=1
fi

# --- 3. translations -------------------------------------------------------

step "translations"
node -e '
  const fs = require("fs");
  const src = fs.readFileSync("scripts/i18n.mjs", "utf8");
  const split = src.indexOf("  pl: {");
  const rx = /"([a-zA-Z]+\.[a-zA-Z.]+)":/g;
  const en = new Set([...src.slice(0, split).matchAll(rx)].map((m) => m[1]));
  const pl = new Set([...src.slice(split).matchAll(rx)].map((m) => m[1]));
  const onlyEn = [...en].filter((k) => !pl.has(k));
  const onlyPl = [...pl].filter((k) => !en.has(k));

  // Keys used in templates must exist. Keys built from a variable in code
  // (`check.kind.${type}`) cannot be checked this way and are skipped.
  const used = new Set();
  for (const f of fs.readdirSync("templates")) {
    const t = fs.readFileSync("templates/" + f, "utf8");
    for (const m of t.matchAll(/pkT "([^"]+)"/g)) used.add(m[1]);
  }
  const undefinedKeys = [...used].filter((k) => !en.has(k));

  let bad = 0;
  if (onlyEn.length) { console.log("  FAIL only in en: " + onlyEn.join(", ")); bad = 1; }
  if (onlyPl.length) { console.log("  FAIL only in pl: " + onlyPl.join(", ")); bad = 1; }
  if (undefinedKeys.length) { console.log("  FAIL used but undefined: " + undefinedKeys.join(", ")); bad = 1; }
  if (!bad) console.log("  ok   " + en.size + " keys, both languages agree");
  process.exit(bad);
' || fail=1

# --- 4. imports ------------------------------------------------------------
#
# A cycle works in ES modules only as long as nobody imports a const across it,
# which is a trap rather than a design.

step "imports"
node -e '
  const fs = require("fs");
  const files = fs.readdirSync("scripts");
  const graph = {};
  for (const f of files) {
    const t = fs.readFileSync("scripts/" + f, "utf8");
    graph[f] = [...t.matchAll(/from "\.\/([^"]+)"/g)].map((m) => m[1]);
  }

  let bad = 0;
  for (const f of files) {
    for (const dep of graph[f]) {
      if (!fs.existsSync("scripts/" + dep)) {
        console.log("  FAIL " + f + " imports missing " + dep);
        bad = 1;
      }
    }
  }

  const cycles = new Set();
  const walk = (n, path) => {
    if (path.includes(n)) {
      cycles.add([...path.slice(path.indexOf(n)), n].join(" -> "));
      return;
    }
    for (const d of graph[n] || []) walk(d, [...path, n]);
  };
  for (const f of files) walk(f, []);
  if (cycles.size) { console.log("  FAIL cycles:\n    " + [...cycles].join("\n    ")); bad = 1; }
  else if (!bad) console.log("  ok   no cycles, every import resolves");
  process.exit(bad);
' || fail=1

# --- 5. version ------------------------------------------------------------
#
# module.json and the README carry the number separately, and they have drifted
# apart before.

step "version"
node -e '
  const fs = require("fs");
  const version = JSON.parse(fs.readFileSync("module.json", "utf8")).version;
  const readme = fs.readFileSync("README.md", "utf8");
  const mentions = [...readme.matchAll(/\*\*(\d+\.\d+\.\d+)\*\*/g)].map((m) => m[1]);
  const wrong = [...new Set(mentions)].filter((v) => v !== version);
  if (wrong.length) {
    console.log("  FAIL module.json says " + version + ", README says " + wrong.join(", "));
    process.exit(1);
  }
  console.log("  ok   " + version + " everywhere");
' || fail=1

# --- 6. tests --------------------------------------------------------------

step "tests"
node tests/steps-smoke.mjs > /tmp/pk5e-smoke.log 2>&1
if [ $? -eq 0 ]; then
  ok "steps build and run"
else
  cat /tmp/pk5e-smoke.log | sed 's/^/  /'
  fail=1
fi

node tests/run.mjs > /tmp/pk5e-tests.log 2>&1
if [ $? -eq 0 ]; then
  tail -n 1 /tmp/pk5e-tests.log | sed 's/^/  ok   /'
else
  cat /tmp/pk5e-tests.log | sed 's/^/  /'
  fail=1
fi

# --- result ----------------------------------------------------------------

printf '\n'
if [ "$fail" -eq 0 ]; then
  echo "all checks passed"
else
  echo "SOMETHING FAILED - see above"
fi
exit "$fail"
