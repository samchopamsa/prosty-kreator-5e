/**
 * selftest.mjs
 * ---------------------------------------------------------------------------
 * Czy nasze zaczepienia w cudzym markupie jeszcze trzymaja - pytane w zywym
 * swiecie, jedna komenda.
 *
 * DLACZEGO
 * --------
 * Polowa tego modulu stoi na markupie, ktorego nie jestesmy wlascicielem:
 * przyciski karty dnd5e, okno importera, kontrolki Tidy, wiersze przegladarki
 * kompendiow. Wszystkie te miejsca zawodza CICHO, i to jest swiadoma decyzja -
 * zepsuty selektor ma zostawic tworzenie postaci w spokoju, a nie wywrocic je
 * bledem.
 *
 * Cena jest taka, ze awaria wyglada jak "jakos nic sie nie dzieje". Sprawa
 * z 1.49.2 przesiedziala tak dziesiec wersji: przycisk celowal w anchory,
 * ktorych Tidy nie ma, wiec na swiecie z Tidy nie wstawial sie nigdzie i nic
 * nie wygladalo na zepsute.
 *
 * tests/markup.mjs pilnuje tego z drugiej strony - ale na fixture, czyli na
 * markupie, ktory MY zapisalismy. Wykryje wiec nasza regresje i nigdy nie
 * wykryje, ze importer zmienil swoj. Jedynym miejscem, gdzie widac prawde,
 * jest zywy swiat, i stad ten plik.
 *
 *   characterCreator.selfTest()
 *
 * TRZY WYNIKI, NIE DWA
 * --------------------
 * "ok" i "NIE ZNALEZIONO" nie wystarczaja, bo wiekszosci rzeczy nie da sie
 * sprawdzic, gdy odpowiednie okno jest zamkniete. Trzeci wynik - "pominieto" -
 * mowi wprost, ze nic nie zostalo sprawdzone. Bez niego zamkniete okno
 * czytaloby sie jak sukces, czyli dokladnie tak, jak awaria, ktorej szukamy.
 */

import { MODULE_ID, IMPORTER_ID } from "./constants.mjs";
import { isAvailable as rulesAvailable } from "./rules-data.mjs";
import { tidyHandlesCharacters, tidyControlsRegistered } from "./tidy.mjs";
import { LEVEL_UP_SELECTORS } from "./sheet-actions.mjs";
import { DIALOGS } from "./option-watch.mjs";

const OK = "ok";
const MISSING = "NIE ZNALEZIONO";
const SKIPPED = "pominieto";

/** Jeden wiersz raportu. */
const result = (name, status, detail = "") => ({ name, status, detail });

/**
 * Karta postaci, na ktorej da sie cokolwiek sprawdzic.
 *
 * Nie otwieramy jej sami: selfTest ma opisywac swiat, a nie go zmieniac.
 * Zamknieta karta to powod do "pominieto", nie do klikania za uzytkownika.
 */
function openCharacterSheet() {
  for (const app of foundry.applications.instances?.values() ?? []) {
    const actor = app?.actor;
    if (actor?.type === "character" && app.element) return app;
  }
  for (const app of Object.values(ui.windows ?? {})) {
    if (app?.actor?.type === "character" && app.element) return app;
  }
  return null;
}

/** Element okna, niezaleznie od tego, czy Foundry oddaje element czy jQuery. */
function rootOf(app) {
  const el = app?.element;
  return el instanceof HTMLElement ? el : (el?.[0] ?? null);
}

/**
 * Tytul okna importera.
 *
 * Ten sam zestaw selektorow, co w option-watch.mjs i importer-watch.mjs -
 * celowo powtorzony, a nie zaimportowany: gdyby te pliki kiedys sie rozjechaly,
 * narzedzie diagnostyczne ma pokazywac to, co widzi, a nie to, co widzi jeden
 * z nich.
 */
function titleOf(app) {
  return app?.querySelector?.(".window-title, .header-title, header h1")?.textContent?.trim() ?? "";
}

function importerWindow() {
  return Array.from(document.querySelectorAll(".ve-app")).find((app) =>
    /import\s+classes/i.test(titleOf(app))
  );
}

/**
 * Sprawdza wszystko, co da sie sprawdzic w tej chwili, i mowi, czego nie dalo.
 *
 * Zwraca liste wynikow, zeby dalo sie ja obejrzec w konsoli poza tabelka.
 */
export function selfTest() {
  const checks = [];

  // --- srodowisko ----------------------------------------------------------

  checks.push(
    result(
      "system dnd5e",
      game.system?.id === "dnd5e" ? OK : MISSING,
      `${game.system?.id ?? "?"} ${game.system?.version ?? ""}`.trim()
    )
  );
  checks.push(result("Foundry", OK, game.version ?? game.data?.version ?? "?"));

  const importer = game.modules.get(IMPORTER_ID);
  checks.push(
    result(
      "modul importera",
      importer?.active ? OK : SKIPPED,
      importer?.active
        ? `wersja ${importer.version ?? "?"}`
        : "nieaktywny - kroki gatunku, pochodzenia i klasy ida przez Compendium Browser"
    )
  );

  // Biblioteki regul importera sa tym, z czego czytamy reguly. Bez nich checkup.mjs
  // i opisy klas nie maja o czym mowic, ale reszta modulu dziala.
  checks.push(
    result(
      "biblioteki regul (DataUtil.class.loadJSON)",
      rulesAvailable() ? OK : SKIPPED,
      rulesAvailable()
        ? "porownanie z regulami dostepne"
        : "brak - porownanie z regulami i opisy klas nieczynne"
    )
  );

  const tidy = game.modules.get("tidy5e-sheet");
  checks.push(
    result(
      "Tidy 5e Sheets",
      tidy?.active ? (tidyHandlesCharacters() ? OK : MISSING) : SKIPPED,
      tidy?.active
        ? tidyHandlesCharacters()
          ? "obsluguje karty postaci, kontrolki rejestrowane przez API"
          : "aktywny, ale nie obsluguje kart postaci"
        : "nieaktywny"
    )
  );

  // --- karta postaci -------------------------------------------------------

  const sheetApp = openCharacterSheet();
  const sheet = rootOf(sheetApp);

  if (!sheet) {
    checks.push(
      result("karta postaci", SKIPPED, "zadna nie jest otwarta - otworz karte i powtorz")
    );
  } else {
    checks.push(result("karta postaci", OK, sheetApp.constructor?.name ?? "?"));

    // Nasz wlasny przycisk. Jego brak to najczestsza awaria tego modulu
    // i jedyna, ktora widac golym okiem - jesli sie o niej wie.
    //
    // Dwie drogi, dwa pytania. Na karcie dnd5e wstawiamy element sami, wiec
    // pytamy DOM. Tidy renderuje kontrolke po swojemu, w Svelte, wiec szukanie
    // tam naszej klasy nic nie znaczy i pytamy o rejestracje w jego API.
    // Zadawanie obu swiatom tego samego pytania dawaloby falszywy alarm
    // dokladnie tam, gdzie 1.49.2 kazala nam byc ostroznymi.
    if (tidyHandlesCharacters()) {
      checks.push(
        result(
          "kontrolki kreatora (Tidy)",
          tidyControlsRegistered() ? OK : MISSING,
          tidyControlsRegistered()
            ? "zarejestrowane przez registerCharacterHeaderControls"
            : "API Tidy nie przyjelo naszych kontrolek - patrz characterCreator.tidy()"
        )
      );
    } else {
      checks.push(
        result(
          "przycisk kreatora na karcie",
          sheet.querySelector(".pk5e-sheet-button") ? OK : MISSING,
          "wstawiany przez sheet-button.mjs obok przyciskow odpoczynku"
        )
      );
    }

    // Przyciski "Dodaj klase/gatunek/pochodzenie" istnieja tylko w trybie
    // edycji, wiec ich brak w trybie gry nie jest awaria.
    const addButtons = sheet.querySelectorAll("[data-action='findItem']").length;
    checks.push(
      result(
        "przyciski dodawania (data-action='findItem')",
        addButtons ? OK : SKIPPED,
        addButtons
          ? `${addButtons} na karcie`
          : "brak - karta jest zwykle w trybie gry, przelacz na edycje i powtorz"
      )
    );

    const levelUp = LEVEL_UP_SELECTORS.map((s) => sheet.querySelectorAll(s).length).reduce(
      (a, b) => a + b,
      0
    );

    // Przycisk awansu pojawia sie tylko tam, gdzie awans ma sens: na postaci
    // z klasa. Zglaszanie jego braku na pustej karcie bylo falszywym alarmem -
    // pierwszy przebieg selfTest w prawdziwym swiecie zlapal wlasnie to, na
    // postaci "New Character" w trakcie importu pierwszej klasy.
    //
    // Narzedzie, ktore krzyczy o rzeczy dzialajacej poprawnie, uczy ignorowac
    // swoje wyniki - a wtedy przestaje byc warte uruchamiania.
    const hasClass = !!sheetApp.actor?.items?.some?.((i) => i.type === "class");
    checks.push(
      result(
        "przycisk awansu importera",
        !importer?.active ? SKIPPED : !hasClass ? SKIPPED : levelUp ? OK : MISSING,
        !importer?.active
          ? "importer nieaktywny"
          : !hasClass
            ? "postac nie ma jeszcze klasy - przycisk awansu pojawia sie dopiero z nia"
            : levelUp
              ? `${levelUp} dopasowan`
              : "importer aktywny, postac ma klase, a przycisku nie ma - okno awansu " +
                "nie bedzie mialo czego nacisnac"
      )
    );
  }

  // --- okno importera ------------------------------------------------------

  const win = importerWindow();
  if (!win) {
    checks.push(
      result(
        "okno importera klas",
        SKIPPED,
        "zamkniete - otworz je i powtorz, to jedyny sposob sprawdzenia tych selektorow"
      )
    );
  } else {
    checks.push(result("okno importera klas", OK, "rozpoznane po tytule"));

    const list = win.querySelector(".veapp__list");
    checks.push(
      result("lista wierszy (div.veapp__list)", list ? OK : MISSING, list ? "" : "zmienil sie markup listy")
    );

    if (list) {
      const rows = Array.from(list.querySelectorAll("label"));
      const named = rows.filter((r) => r.querySelector(".ve-col-9")).length;
      checks.push(
        result(
          "komorka nazwy (span.ve-col-9)",
          named ? OK : MISSING,
          `${named} z ${rows.length} wierszy ma czytelna nazwe`
        )
      );

      const sourced = rows.filter((r) => r.querySelector("[class*='ve-source__']")).length;
      checks.push(
        result(
          "kod ksiazki (klasa ve-source__*)",
          sourced ? OK : MISSING,
          `${sourced} z ${rows.length} wierszy`
        )
      );

      const subclasses = rows.filter((r) => {
        const cell = r.querySelector(".ve-col-9");
        return cell && !cell.classList.contains("ve-bold");
      });
      const withParent = subclasses.filter((r) =>
        /class:/i.test(r.querySelector(".ve-col-9")?.getAttribute("title") ?? "")
      ).length;
      checks.push(
        result(
          "rodzic podklasy (title=\"Class: ...\")",
          subclasses.length === 0 ? SKIPPED : withParent ? OK : MISSING,
          subclasses.length === 0
            ? "brak wierszy podklas na liscie"
            : `${withParent} z ${subclasses.length} podklas nazywa swoja klase`
        )
      );
    }
  }

  // --- wydruk --------------------------------------------------------------

  const missing = checks.filter((c) => c.status === MISSING);
  const skipped = checks.filter((c) => c.status === SKIPPED);

  console.group(`${MODULE_ID} | selfTest`);
  console.table(checks.map((c) => ({ sprawdzenie: c.name, wynik: c.status, szczegoly: c.detail })));

  if (missing.length) {
    console.warn(
      `${missing.length} rzeczy nie znaleziono. To znaczy, ze siegamy w markup, ktory sie zmienil - ` +
        "odpowiadajace funkcje po prostu nic nie robia i nie zglaszaja bledu.",
      missing.map((c) => c.name)
    );
  }
  if (skipped.length) {
    console.info(
      `${skipped.length} pominieto - nie dalo sie sprawdzic w tym stanie ekranu. ` +
        "To NIE jest zaliczenie. Otworz karte postaci i okno importera, potem powtorz.",
      skipped.map((c) => c.name)
    );
  }
  if (!missing.length && !skipped.length) console.log("wszystko na miejscu");
  console.groupEnd();

  return checks;
}

/**
 * Zgrywa markup okna importera w postaci nadajacej sie na fixture testowy.
 *
 * DLACZEGO TO ISTNIEJE
 * --------------------
 * tests/fixtures/importer-class-list.html zostal ODTWORZONY z opisu
 * w naglowku importer-watch.mjs, nie zgrany z zywego okna. Wykrywa wiec nasze
 * regresje i nie wykryje zmiany po stronie importera. Zeby to naprawic, ktos
 * musi po kazdej aktualizacji importera wkleic swiezy markup - a czynnosc,
 * ktora ma sie powtarzac, musi byc jednym poleceniem, bo inaczej nie powtorzy
 * sie nigdy.
 *
 * DLACZEGO PRZYCINAMY
 * -------------------
 * Importer wypisuje ponad trzysta wierszy. Fixture tej wielkosci jest nie do
 * przeczytania w diffie i nie sprawdza niczego wiecej niz kilkanascie wierszy,
 * bo kazdy kolejny ma ten sam ksztalt. Domyslnie zostaje wiec probka -
 * z zachowaniem obu rodzajow wiersza, bo klasa i podklasa roznia sie markupem
 * i to wlasnie ta roznice czytamy.
 *
 *   characterCreator.captureImporter()            probka, do schowka
 *   characterCreator.captureImporter({ rows: 40 })
 *   characterCreator.captureImporter({ full: true })   calosc, bez przycinania
 *
 * @returns {string|null} markup, takze gdy schowek odmowil
 */
export async function captureImporter({ rows = 12, full = false } = {}) {
  const win = importerWindow();
  if (!win) {
    console.warn(
      `${MODULE_ID} | Okno importera klas nie jest otwarte. Otworz je (krok klasy w panelu ` +
        "albo przycisk importu na karcie) i powtorz."
    );
    return null;
  }

  const copy = win.cloneNode(true);
  const list = copy.querySelector(".veapp__list");

  if (list && !full) {
    const all = Array.from(list.children);
    const isSubclass = (el) => {
      const cell = el.querySelector?.(".ve-col-9");
      return cell && !cell.classList.contains("ve-bold");
    };

    // Probka z obu rodzajow wiersza. Sama gora listy potrafi byc wylacznie
    // klasami, a wtedy fixture nie mialby na czym pokazac odciecia myslnika
    // ani czytania rodzica z atrybutu title.
    const classes = all.filter((el) => !isSubclass(el)).slice(0, Math.ceil(rows / 2));
    const subs = all.filter(isSubclass).slice(0, Math.floor(rows / 2));
    const keep = new Set([...classes, ...subs]);

    let removed = 0;
    for (const el of all) {
      if (!keep.has(el)) {
        el.remove();
        removed += 1;
      }
    }
    if (removed) {
      list.appendChild(
        copy.ownerDocument.createComment(
          ` przyciete: ${removed} wierszy pominieto, zostawiono ${keep.size} (${classes.length} klas, ${subs.length} podklas). ` +
            `Pelny zrzut: characterCreator.captureImporter({ full: true }) `
        )
      );
    }
  }

  const markup = copy.outerHTML;

  let copied = false;
  try {
    await navigator.clipboard.writeText(markup);
    copied = true;
  } catch (err) {
    // Schowek wymaga zaufanego zdarzenia albo uprawnienia i potrafi odmowic
    // bez powodu widocznego dla nas. Markup i tak zwracamy - to on jest celem.
    trySelectionCopy(markup) && (copied = true);
  }

  console.group(`${MODULE_ID} | captureImporter`);
  console.log(
    copied
      ? "Markup w schowku."
      : "Schowek odmowil - markup jest ponizej i jako wartosc zwrocona przez te funkcje."
  );
  console.log(
    `${(markup.length / 1024).toFixed(1)} kB${full ? " (calosc)" : ", probka - pelny zrzut: { full: true }"}`
  );
  console.log(
    "Wklej w miejsce zawartosci tests/fixtures/importer-class-list.html, PONIZEJ komentarza\n" +
      "naglowkowego, i zostaw ten komentarz - opisuje, czym plik jest. Potem:\n" +
      "  npm install --no-save handlebars jsdom && node tests/markup.mjs\n" +
      "Czerwone testy po podmianie na prawdziwy markup sa dobra wiadomoscia: znaczy, ze fixture\n" +
      "wreszcie mowi cos, czego odtworzony nie mowil."
  );
  if (!copied) console.log(markup);
  console.groupEnd();

  return markup;
}

/**
 * Opisuje okna dialogowe importera otwarte w tej chwili - i mowi, czy
 * option-watch.mjs w ogole je rozpoznaje.
 *
 * DLACZEGO
 * --------
 * Obserwator pominietych wyborow dziala z tabeli DIALOGS: jeden wpis na rodzaj
 * okna, z wlasnym pomyslem na to, co znaczy "skonczone". Okno, ktorego w tabeli
 * nie ma, jest dla nas NIEWIDZIALNE - gracz moze je zamknac bez wyboru, a
 * kreator powie, ze wszystko w porzadku. Awaria po cichu, znowu.
 *
 * Dopisanie wpisu wymaga trzech rzeczy, ktorych nie da sie zgadnac zza ekranu:
 * dokladnego tytulu, etykiety przycisku potwierdzenia i tego, po czym poznac
 * niedokonczony wybor - raz jest to licznik "2/3", raz lista na mysliku, raz
 * "Remaining: 2". To polecenie zbiera wszystkie trzy z zywego okna.
 *
 *   characterCreator.captureDialog()
 *
 * Uruchom przy OTWARTYM oknie, ktore chcesz opisac.
 */
export async function captureDialog() {
  const windows = Array.from(document.querySelectorAll(".ve-app")).filter(
    (el) => el.offsetParent !== null
  );

  if (!windows.length) {
    console.warn(
      `${MODULE_ID} | Zadne okno importera nie jest otwarte. Uruchom to, gdy okno wyboru ` +
        "jest na ekranie."
    );
    return null;
  }

  const described = windows.map((app) => {
    const title = titleOf(app);
    const text = app.textContent ?? "";

    const buttons = Array.from(app.querySelectorAll("button, .ve-btn")).map((b) => ({
      tekst: (b.textContent ?? "").trim().slice(0, 40),
      primary: b.classList.contains("ve-btn-primary"),
      klasy: b.className
    }));

    // Trzy ksztalty "niedokonczonego", ktore juz znamy z innych okien. Ktorys
    // z nich zwykle pasuje, a jesli zaden - to jest wlasnie ta informacja.
    const selects = Array.from(app.querySelectorAll("select"));
    const liczniki = [
      ...text.matchAll(/([a-z ]+):\s*(\d+)\s*\/\s*(\d+)/gi),
      ...text.matchAll(/(remaining|pozostalo):\s*(\d+)/gi)
    ].map((m) => m[0].trim());

    // Czy ktorykolwiek wpis DIALOGS rozpoznaje to okno.
    const matched = DIALOGS.filter((d) => {
      try {
        return d.match(title, app);
      } catch {
        return false;
      }
    }).map((d) => d.id);

    return {
      title,
      rozpoznane: matched.length ? matched.join(", ") : "NIE - to okno jest dla nas niewidzialne",
      przyciski: buttons,
      list: selects.length,
      listNaMysliku: selects.filter((s) => !s.value || /^[-–—]$/.test(s.value.trim())).length,
      liczniki,
      radio: app.querySelectorAll("input[type='radio']").length,
      checkbox: app.querySelectorAll("input[type='checkbox']").length,
      tekst: text.replace(/\s+/g, " ").trim().slice(0, 300),
      markup: app.outerHTML
    };
  });

  console.group(`${MODULE_ID} | captureDialog - ${described.length} okien`);
  for (const d of described) {
    console.group(`"${d.title || "(bez tytulu)"}"`);
    console.log("rozpoznane przez DIALOGS:", d.rozpoznane);
    console.table(d.przyciski);
    console.log("list:", d.list, "| na mysliku:", d.listNaMysliku, "| radio:", d.radio, "| checkbox:", d.checkbox);
    console.log("liczniki:", d.liczniki.length ? d.liczniki : "(zadnych)");
    console.log("tekst:", d.tekst);
    console.groupEnd();
  }
  console.groupEnd();

  // Do schowka wersja bez markupu - to ona nadaje sie do wklejenia w rozmowie.
  // Pelny markup zostaje w zwroconym obiekcie, gdyby byl potrzebny.
  const summary = JSON.stringify(
    described.map(({ markup, ...rest }) => rest),
    null,
    2
  );
  try {
    await navigator.clipboard.writeText(summary);
    console.log("Opis w schowku.");
  } catch (err) {
    if (!trySelectionCopy(summary)) console.log(summary);
  }

  return described;
}

/** Ostatnia deska ratunku dla schowka: zaznaczenie i execCommand. */
function trySelectionCopy(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const done = document.execCommand("copy");
    area.remove();
    return done;
  } catch (err) {
    return false;
  }
}
