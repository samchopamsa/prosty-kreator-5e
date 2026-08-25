# Prosty Kreator Postaci (D&D 5e)

Prowadzony krok po kroku kreator postaci dla Foundry VTT i systemu **dnd5e**.

Moduł **niczego nie reimplementuje**. Każdy krok klika prawdziwy przycisk karty
postaci — „Dodaj gatunek", „Dodaj pochodzenie", „Dodaj klasę" — więc system
Advancement i importery takie jak Plutonium działają dokładnie tak, jak zostały
zbudowane. Kreator dokłada trzy rzeczy, których brakuje: **kolejność**, **to,
o co importery nigdy nie pytają** (punktacja cech, języki) i **wykrywanie tego,
co zostało pominięte**.

Wersja **1.59.0**.

---

## Instalacja

W Foundry: *Konfiguracja* → *Dodatki* → *Moduły* → *Zainstaluj moduł* → w polu
*Adres manifestu* wklej:

```
https://github.com/samchopamsa/prosty-kreator-5e/releases/latest/download/module.json
```

### Wymagania

| | wersja |
|---|---|
| Foundry VTT | 13 lub nowszy (sprawdzone na 14) |
| system dnd5e | 5.0.0 lub nowszy (sprawdzone na 5.3.3) |

**Plutonium** — zalecany, nie wymagany. Bez niego kroki gatunku, pochodzenia
i klasy korzystają z systemowej przeglądarki kompendiów, a opisy klas i
porównanie z regułami są niedostępne (te dane pochodzą z bibliotek 5etools,
które ładuje Plutonium).

**Tidy 5e Sheets** — obsługiwane. Przyciski rejestrują się przez API Tidy, a nie
przez wstrzykiwanie do jego markupu.

---

## Siedem kroków

Panel prowadzi przez postać w kolejności, w jakiej decyzje mają sens:

1. **Imię** — dopóki postać nazywa się „New Character", krok nie jest zaliczony
2. **Klasa** — z opisami do przeczytania obok listy importera
3. **Gatunek**
4. **Pochodzenie**
5. **Punktacja cech** — standardowa tablica, zakup punktów, rzuty albo ręcznie
6. **Języki** — wspólny znany zawsze, dwa kolejne to norma
7. **Portret**

Panel czyta kartę i pokazuje, co już na niej wylądowało. Nie próbuje wykrywać,
kiedy zamykasz cudze okno — te okna stoją nad panelem, zamykasz je i wracasz.

---

## Co to daje ponad sam importer

### Punktacja cech, o którą nikt nie pyta

Importery budują niemal gotową kartę — klasę, gatunek, pochodzenie, cechy,
ekwipunek, punkty życia — ale **nigdy nie pytają o punktację cech**. Postać
kończy z dziesiątkami wszędzie i nikt tego nie zauważa aż do pierwszego rzutu.

Uwaga na pułapkę, którą moduł obsługuje: premia z pochodzenia jest wpisywana
**wprost w `system.abilities.X.value`**, a nie trzymana osobno. Nadpisanie
punktacji zniszczyłoby ją po cichu. Dlatego moduł czyta premie z advancementów
postaci i pokazuje działanie, zanim cokolwiek zapisze.

### Opisy klas obok importera

Importer wypisuje same nazwy. Wąski panel przyklejony do jego okna pokazuje, co
dana klasa albo podklasa faktycznie robi — klikasz nazwę w importerze, czytasz
obok. Osobno dostępne jest szerokie okno przeglądania kompendiów.

### Trzy niezależne sposoby wykrywania braków

Są ślepe w różnych miejscach i **żaden nie zastępuje pozostałych**:

- **czytanie karty** — zero punktów życia, zerowa szybkość, nieprzypisane
  premie do cech, puste wpisy Trait, wymagania wieloklasowości
- **czytanie reguł** — porównanie postaci z tym, co klasa faktycznie daje na
  danym poziomie (wymaga Plutonium)
- **obserwowanie okien** — wybory, których dialogi Plutonium **nie zapisują
  nigdzie**: styl walki, sztuczki. Pominięty wybór nie zostawia w danych żadnego
  śladu; jedyny moment, w którym ta informacja istnieje, to czas wyświetlania
  okna

### Awans poziomu, który mówi co się zmieniło

Foundry jest tu dziwnie milczące: klikasz przez kilka okien i lądujesz na
karcie różniącej się w sposób, którego nikt nie wypisuje. Moduł robi odczyt
przed i po, i pokazuje różnicę. Awansuje też o kilka poziomów naraz — importer
robi to po jednym.

---

## Ustawienia

Najważniejsze (pełna lista w *Konfiguracja modułu*):

| ustawienie | domyślnie | uwagi |
|---|---|---|
| Język panelu | `en` | gracz może nadpisać dla siebie; ustawienia i treści z kompendiów zostają po angielsku |
| Jak rozpoznawane są istniejące premie do cech | z advancementów | najodporniejsze — czyta deklaracje z przedmiotów postaci, ignoruje to, co jest na karcie |
| Klikanie przez ekrany startowe importera | wyłączone | **lepiej ustawić w Plutonium** *Use Importer when Using ADD… Button* na *Always* — wtedy importer w ogóle nie pyta |
| Opisy klas obok importera | włączone | |
| Panel opisów wewnątrz okna importera | włączone | wyłącz na małym ekranie, gdzie dwie kolumny zwężają listę |
| Ukryj przycisk awansu Plutonium | wyłączone | tylko stylowanie — przycisk zostaje na karcie, moduł nadal go naciska |
| Gracze mogą zakładać postacie | | wymaga też uprawnienia `ACTOR_CREATE` |

---

## Konsola

Dostępne jako `characterCreator` (oraz `game.modules.get("prosty-kreator-5e").api`):

```js
characterCreator.guide()                    // nowa postać
characterCreator.resume(actorId)            // wróć do zaczętej
characterCreator.complete(actorId)          // punktacja cech na gotowej karcie
characterCreator.levelUp(actorId)

characterCreator.debug(actorId)             // wszystko, co moduł sądzi o postaci
characterCreator.debugCompendiums()
characterCreator.rules("Fighter", 3)        // co reguły przewidują
characterCreator.verify(actor, "Fighter", 3)// postać kontra reguły
characterCreator.tidy()                     // czy Tidy jest wykryte
characterCreator.setDebug(true)             // logowanie na bieżąco
```

`debug()` bez argumentu bierze zaznaczony żeton albo Twoją postać.

---

## Rozwój

Bez zależności i bez kroku budowania — `scripts/*.mjs` to moduły ES ładowane
wprost przez Foundry.

```bash
./check.sh                   # składnia, szablony, tłumaczenia, cykle importów,
                             # zgodność wersji, testy - wszystko przed wypchnięciem
node tests/run.mjs           # testy jednostkowe (globalne Foundry zaślepione)
node tests/steps-smoke.mjs
```

Ten sam `check.sh` chodzi w CI przy każdym push i pull requeście.

Wydanie: podbij `version` w `module.json`, dopisz sekcję w `CHANGELOG.md`,
popraw pole `download` na nowy tag (`check.sh` przypilnuje wszystkich trzech),
a potem:

```bash
git tag v1.60.0 && git push origin main v1.60.0
```

Paczkę, opis wydania z changeloga i sam release tworzy workflow.

Wskazówki dla pracujących nad kodem — w [CLAUDE.md](CLAUDE.md). Notatki
z lektury wnętrzności Plutonium — w [docs/plutonium-internals.md](docs/plutonium-internals.md).

---

## Historia zmian

[CHANGELOG.md](CHANGELOG.md)
