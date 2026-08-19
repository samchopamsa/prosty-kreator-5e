# Historia zmian

Format: jedna sekcja na wersję, najnowsza u góry. Numer wersji zgadza się
z `module.json` i z tagiem gita (`v1.51.0`), więc do każdej da się wrócić:

```
git checkout v1.50.1     # podejrzenie starej wersji
git checkout main        # powrót do bieżącej
```

Wersjonowanie semantyczne: **1.X.0** — nowa funkcja, **1.0.X** — poprawka.

---

## 1.52.0

Dopasowanie regul do karty postaci kluczem, a nie nazwa.

- `featureHash()` buduje ten sam identyfikator, ktorym Plutonium stempluje
  importowane cechy (`flags.plutonium.hash`). Format odczytany z zywej postaci:
  `nazwa_klasa_zrodloKlasy_poziom_zrodlo`, a dla podklas dodatkowo
  `krotkaNazwaPodklasy_zrodloPodklasy` przed poziomem. Testy sa przypiete do
  dwoch prawdziwych hashy.
- `missingFeatures()` porownuje najpierw po hashu, potem po nazwie, i mowi
  ktora droga poszlo dopasowanie. Nazwa jest potrzebna, bo postac zbudowana
  czesciowo z kompendium systemowego ma cechy bez flagi Plutonium.
- `verifyLevel()` i `characterCreator.verify(postac, klasa, poziom)` -
  porownanie prawdziwej karty z regulami. Tylko raport, nic nie zmienia.
- `docs/plutonium-internals.md` - notatki z lektury kodu Plutonium.

## 1.51.0

Wersjonowanie releasów. Bez zmian w działaniu modułu.

- `.github/workflows/release.yml` — wypchnięcie tagu `v*` buduje release
  z `module.json` i `module.zip`. Przed publikacją uruchamia `./check.sh`
  i sprawdza, czy tag zgadza się z wersją w `module.json`.
- `module.json` — pola `manifest` i `download`, dzięki którym Foundry potrafi
  zainstalować i zaktualizować moduł z adresu, a także zainstalować dowolną
  starszą wersję.
- Ten plik.

## 1.50.1

- `subclassFeaturesAtLevel` czytała podklasy jak klasy i zwracała nie to, co
  trzeba. Struktura jest inna: poziom podklasy trzyma opakowanie, a właściwe
  cechy leżą w jego `entries`. Dla 3. poziomu Battle Mastera zwracała „Battle
  Master" zamiast `Combat Superiority`, `Student of War`, `Maneuver Options`,
  a dla 7. poziomu pustą nazwę, bo tamto opakowanie nie ma pola `name`.
  Teraz schodzi do najgłębszej nazwanej cechy z `__prop: "subclassFeature"`.
- Lista manewrów (`optionalfeature`) nie trafia już na listę zysków — to menu
  do wyboru, a nie coś, co poziom daje.

## 1.50.0

- `scripts/fivetools.mjs` — odczyt reguł wprost z danych 5etools, które
  Plutonium ładuje do strony. `gainsForLevel(klasa, poziom)` mówi, co dany
  poziom powinien dać: cechy, kość życia, ekwipunek startowy. Odczyt, bez
  zmieniania czegokolwiek na karcie.
- Źródło jest zawsze jawne (`XPHB` przed `EFA`, `TCE`, `PHB`), bo dane
  zawierają obie edycje naraz, a blokada źródeł w świecie tu nie działa.
- `characterCreator.rules("Fighter", 1)` w konsoli do sprawdzenia odczytu.

## 1.49.2

- Ukrywanie przycisku awansu Plutonium przez `setProperty` z `important`,
  wywoływane przy każdym renderowaniu.
- Przycisk na karcie celuje w `div.sheet-header-buttons`.

## 1.49.0 i wcześniejsze

Historia sprzed wprowadzenia tego pliku jest w commitach. Najważniejsze:
panel opisów przy importerze, wykrywanie pominiętych wyborów dwiema drogami,
okno awansu z porównaniem migawek, wersjonowanie flag, `check.sh` i testy,
podział `guide.mjs` na `steps.mjs` i `sheet-actions.mjs`.
