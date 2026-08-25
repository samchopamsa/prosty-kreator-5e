/**
 * tests/markup.mjs
 * ---------------------------------------------------------------------------
 * Testy tego, co czyta CUDZY markup - dzis okna importera Plutonium.
 *
 * DLACZEGO OSOBNY PLIK
 * --------------------
 * tests/run.mjs nie ma zadnych zaleznosci i to jest jego zaleta: dziala wszedzie,
 * gdzie jest node. Tutaj potrzebny jest prawdziwy DOM - readRow() wola
 * cloneNode(), classList i getAttribute(), a watchImporter() stoi na
 * MutationObserver. Zaslepka tego nie udaje sensownie: test parsera DOM na
 * atrapie DOM sprawdza atrape.
 *
 * Wiec jsdom jest zalezoscia OPCJONALNA, dokladnie jak Handlebars w check.sh:
 * gdy go nie ma, ten plik konczy sie zielono i mowi, ze pominal. W CI jest
 * instalowany, wiec tam testy naprawde chodza.
 *
 *   npm install --no-save jsdom && node tests/markup.mjs
 *
 * CZEGO TE TESTY NIE ZROBIA
 * -------------------------
 * Fixture jest odtworzony z opisu w naglowku importer-watch.mjs, nie zgrany
 * z zywego okna. Wykryja wiec regresje w NASZYM kodzie, a nie zmiane markupu
 * po stronie 5etools. Instrukcja podmiany na prawdziwy zrzut jest w naglowku
 * tests/fixtures/plutonium-import-classes.html i to jest ta czynnosc, ktora
 * naprawde warto powtorzyc po aktualizacji Plutonium.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

let JSDOM;
try {
  ({ JSDOM } = await import("jsdom"));
} catch {
  // "SKIP" jest tu po to, zeby check.sh odroznil pominiecie od zaliczenia.
  // Pominiety test, ktory czyta sie jak zielony, jest gorszy od jego braku.
  console.log("SKIP brak jsdom - testy markupu pominiete (npm install --no-save jsdom)");
  process.exit(0);
}

// --- DOM z fixture, plus tyle Foundry, ile potrzebuje modul ------------------

const html = readFileSync(join(here, "fixtures", "plutonium-import-classes.html"), "utf8");
const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.Node = dom.window.Node;
globalThis.HTMLElement = dom.window.HTMLElement;

// warnMarkup() pyta o game.user.isGM, trace() o ustawienia. Jako GM zobaczymy
// ostrzezenia, ktore sa czescia tego, co testujemy.
globalThis.game = { user: { isGM: true }, settings: { get: () => false } };

const { readRow, watchImporter, importerRect } = await import("../scripts/importer-watch.mjs");

// --- harness, ten sam co w run.mjs ------------------------------------------

let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(`${name}\n       oczekiwano ${b}\n       otrzymano  ${a}`);
    console.log(`  FAIL ${name}`);
  }
}

function group(title, body) {
  console.log(`\n${title}`);
  return body();
}

const row = (kase) => document.querySelector(`[data-case="${kase}"]`);

// --- czytanie pojedynczego wiersza ------------------------------------------

group("importer: czytanie wiersza listy", () => {
  check("klasa: nazwa, typ, kod zrodla z klasy CSS", readRow(row("class-artificer")), {
    name: "Artificer",
    type: "class",
    parentName: "Artificer",
    code: "EFA"
  });

  // Etykieta obok mowi "PHB'24", kod w klasie CSS mowi XPHB. Liczy sie kod:
  // to jego uzywa kompendium do rozstrzygania remisow.
  check("klasa: kod bierze sie z klasy CSS, nie z tresci etykiety", readRow(row("class-cleric")).code, "XPHB");

  check("podklasa: myslnik odciety, rodzic z atrybutu title", readRow(row("subclass-light")), {
    name: "Light Domain",
    type: "subclass",
    parentName: "Cleric",
    code: "XPHB"
  });

  // Ten przypadek zlamal juz dopasowywanie w compendium.mjs: jedna nazwa
  // zawiera druga. Tutaj pilnujemy tylko, ze czytanie ich nie skleja.
  check("podklasa, ktorej nazwa zawiera nazwe innej", readRow(row("subclass-twilight")), {
    name: "Twilight Domain",
    type: "subclass",
    parentName: "Cleric",
    code: "TCE"
  });

  check("brak komorki zrodla to pusty kod, nie blad", readRow(row("subclass-no-source")).code, "");

  check("wiersz bez komorki nazwy to null", readRow(row("not-a-row")), null);
  check("null nie wywraca readRow", readRow(null), null);
  check("obiekt bez querySelector nie wywraca readRow", readRow({}), null);
});

// --- rozpoznanie okna --------------------------------------------------------

group("importer: rozpoznanie okna", () => {
  const rect = importerRect();
  check("okno importera zostalo znalezione po tytule", rect !== null, true);

  // Ekran wyboru zrodel i wybor narzedzia dziela klase ve-app z importerem.
  // Rozroznia je wylacznie tytul, wiec to on jest tu sprawdzany.
  const other = document.createElement("div");
  other.className = "ve-app";
  other.innerHTML = '<h1 class="window-title">Select Sources</h1>';
  document.body.appendChild(other);
  check("inne okno ve-app nie udaje importera", importerRect() !== null, true);
  document.querySelector('[data-fixture="plutonium-import-classes"]').remove();
  check("po usunieciu importera zostaje samo Select Sources i nie jest brane", importerRect(), null);
});

// --- obserwowanie zaznaczen --------------------------------------------------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// SETTLE_MS wynosi 60; czekamy z zapasem, ale nie tyle, zeby test byl wolny.
const SETTLED = 150;

await group("importer: co trafia do panelu po kliknieciu", async () => {
  // Fixture zostal wyzej usuniety - odbudowujemy czysty dokument.
  dom.window.document.body.innerHTML = html;

  const seen = [];
  const stop = watchImporter({ onSelect: (r) => seen.push(r), onClose: () => seen.push("closed") });

  const select = (kase) => row(kase).classList.add("list-multi-selected");

  select("class-cleric");
  await wait(SETTLED);
  check("klikniecie klasy podaje ta klase", seen.at(-1)?.name, "Cleric");

  // Klikniecie podklasy podswietla przy okazji jej klase. Obie mutacje moga
  // trafic w jedna partie - i wtedy wygrac ma podklasa, bo to ona byla
  // klinieciem, a klasa jego skutkiem ubocznym.
  //
  // KOLEJNOSC W PARTII JEST TU CALYM TESTEM. Gdy podklasa jest ostatnia,
  // "ostatnia podklasa" i "ostatni wiersz" daja te sama odpowiedz i test
  // przechodzi takze dla kodu, ktory bierze po prostu ostatni wiersz. Dopiero
  // klasa NA KONCU partii rozroznia jedno od drugiego - a tego, ktora bedzie
  // ostatnia, nie kontrolujemy, wiec liczy sie wlasnie ten przypadek.
  seen.length = 0;
  select("subclass-twilight");
  select("class-artificer");
  await wait(SETTLED);
  check(
    "podklasa wygrywa, nawet gdy klasa przyszla po niej",
    seen.map((r) => r.name),
    ["Twilight Domain"]
  );

  // I ten sam uklad w druga strone, zeby nie zalezalo od kolejnosci wcale.
  seen.length = 0;
  for (const el of document.querySelectorAll(".veapp__list label")) {
    el.classList.remove("list-multi-selected");
  }
  await wait(SETTLED);
  seen.length = 0;
  select("class-cleric");
  select("subclass-light");
  await wait(SETTLED);
  check(
    "podklasa wygrywa takze, gdy przyszla po klasie",
    seen.map((r) => r.name),
    ["Light Domain"]
  );

  // Odznaczenie nie czysci panelu: czytajacy prawdopodobnie wciaz czyta.
  seen.length = 0;
  row("subclass-twilight").classList.remove("list-multi-selected");
  await wait(SETTLED);
  check("odznaczenie niczego nie zglasza", seen, []);

  // Filtrowanie przemalowuje cala liste naraz. To nie jest wybor gracza.
  seen.length = 0;
  for (const el of document.querySelectorAll(".veapp__list label")) {
    el.classList.remove("list-multi-selected");
  }
  await wait(20);
  for (let i = 0; i < 12; i += 1) {
    const el = document.createElement("label");
    el.innerHTML = '<span class="ve-col-9 ve-bold">Bulk</span>';
    document.querySelector(".veapp__list").appendChild(el);
    el.classList.add("list-multi-selected");
  }
  await wait(SETTLED);
  check("hurtowe przemalowanie listy nie jest wyborem", seen, []);

  stop();

  // Po zatrzymaniu obserwator ma milczec - inaczej panel zyje dluzej niz okno,
  // ktore obsluguje.
  seen.length = 0;
  select("subclass-light");
  await wait(SETTLED);
  check("po stop() nic wiecej nie przychodzi", seen, []);
});

// --- wynik -------------------------------------------------------------------

console.log("");
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`\n  ${passed} przeszlo, ${failures.length} nie`);
  process.exit(1);
}
console.log(`  ${passed} przeszlo, 0 nie`);
