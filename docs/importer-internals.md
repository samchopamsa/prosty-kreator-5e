# Jak importer mapuje swoje dane na dnd5e

Notatki z lektury pakietu dystrybucyjnego importera — jednego wielkiego,
niezminifikowanego pliku JS (~189 tys. linii) z komentarzami autora.

Numerów linii tu nie ma, bo zmieniają się z każdą wersją. Są nazwy — te są
stabilne i wystarczą do `grep`.

---

## Skąd biorą się wpisy Advancement

Importer **nie** czyta Advancement z kompendium. Importuje cechy jako osobne
przedmioty, a dopiero potem dopina je do przedmiotu nadrzędnego, tworząc wpisy
`ItemGrant` — po jednym na poziom, żeby nie mnożyć wierszy.

Robi to `UtilAdvancements.pAddItemGrantAdvancementLinks({actor,
parentEmbeddedDocument, childLevelledEmbeddedDocuments})`. Funkcja wychodzi bez
efektu, gdy nie ma rodzica albo lista dzieci jest pusta.

Wywołań jest kilka, po jednym na rodzaj rodzica: gatunek, pochodzenie, klasa
i podklasa. Dla klasy i podklasy robi to `_pImportEntry_pAddAdvancements`,
która trzyma dwie osobne listy — `importedClassFeatureLevelledEmbeddedDocuments`
i `importedSubclassFeatureLevelledEmbeddedDocuments`. O tym, do której trafi
cecha, decyduje pole `ancestorSubclassName` na cesze.

Po dopięciu każda cecha dostaje flagę `advancementOrigin` we własnej przestrzeni nazw w formacie
`"<id rodzica>.<id wpisu Advancement>"`, czyli powiązanie działa w obie strony.

## Dlaczego detekcja pominiętych wyborów z Advancement nie zadziała

W budowanym wpisie `ItemGrant` autor ustawia `optional: false` i opatruje to
komentarzem, że wszystkie wybory cech *udają* statyczne. Powtórzonym dwa razy
w tej samej funkcji.

Skutkiem jest to, że dla dnd5e taki wpis nie zawiera żadnego wyboru — jest
listą rzeczy nadanych wprost. Wpis `ItemGrant` pochodzący z importera nigdy
więc nie będzie wyglądał na pominięty, choćby gracz zamknął okno wyboru od
razu. To ograniczenie strukturalne, nie błąd do obejścia.

Stąd `scripts/fivetools.mjs`: czego nie da się odczytać z karty, trzeba
porównać z regułami.

## Ustawienia, które na to wpływają

- `import.isUseAdvancementBackingCompendium` — domyślnie **wyłączone**. Przy
  wyłączonym `backingUuid` wskazuje na sam importowany przedmiot, co autor
  w komentarzu nazywa „somewhat nonsensical" i rozważa usunięcie. Nie warto
  opierać niczego na tych UUID-ach.
- Ustawienie o krótkim wyłączaniu domyślnego przepływu Advancement przy
  upuszczaniu przedmiotu na kartę — to ono sprawia, że importer
  przejmuje kontrolę zamiast systemowego mechanizmu.

## Ekwipunek startowy

Importer czyta `startingEquipment.defaultData` wprost — tę samą strukturę,
którą parsuje nasze `equipmentOptions()`. Blokada źródeł świata **jest** tu
stosowana: `getBlocklistFiltered({compEquipmentAvailable,
startingEquipmentData})` odsiewa pozycje przed pokazaniem ich graczowi.

`goldAlternative` obsługuje osobny komponent, który zamienia zapis w rzut
albo w kwotę wpisywaną ręcznie.

## Nazwy warte zapamiętania do szukania

| Czego szukasz | Nazwa w kodzie |
|---|---|
| tworzenie wpisów Advancement | `UtilAdvancements.pAddItemGrantAdvancementLinks` |
| rozdział cech klasa/podklasa | `_pImportEntry_pAddAdvancements` |
| import pojedynczej cechy | `ImporterClassSubclassFeature` |
| filtrowanie ekwipunku blokadą źródeł | `getBlocklistFiltered` |
| odczyt danych klas | `DataUtil.class.loadJSON` |
| konfiguracja | `Config.get("import", ...)` |

---

## Pełny kreator postaci a nasze dopasowywanie (pomiar 2026-08-25)

Importer w wydaniu dla patronów niesie **pełny kreator postaci** — jedno
zakładkowe okno pod tytułem `Charactermancer (Actor "<nazwa>")`, robiące całe
tworzenie postaci naraz. Zmierzone na buildzie `3.17.2.noble-prerelease-25-83`,
Foundry 14.367, dnd5e 5.3.3.

### Zastępuje, nie współistnieje

Przycisk „Dodaj klasę" na karcie otwiera **jego**, a nie okno `Import Classes`.
Przy aktywnym buildzie patronów nasz panel opisów klas i obserwator okien
wyboru nie mają więc odbiorcy — te okna przestają się otwierać.

Nasz moduł znosi to bez zmian i to jest zasługa reguły założycielskiej:
naciskamy przycisk karty, a co się za nim otworzy, to nie nasza sprawa.
Kroki panelu nadal się zaliczają, bo czytają, co wylądowało na karcie.

### Stempluje IDENTYCZNIE — i to jest dobra wiadomość

Postać zbudowana w pełnym kreatorze, po „Finalize":

```
cechy: 9 z 9 ma hash

Spellcasting            classFeature   spellcasting_cleric_xphb_1_xphb
Divine Order            classFeature   divine%20order_cleric_xphb_1_xphb
Divine Order: Protector classFeature   protector_cleric_xphb_1_xphb
Celestial Resistance    raceFeature    celestial%20resistance_aasimar_xphb_xphb
Magic Initiate; Cleric  feats.html     magic%20initiate%3b%20cleric_xphb
```

Format cech klasowych to `name_className_classSource_level_source` — dokładnie
to, co buduje `featureHash()` w `rules-data.mjs`. Znaczy to, że
`verifyCharacter()` i `missingFeatures()` działają na postaciach z pełnego
kreatora **bez żadnej zmiany**, dopasowując po hashu, a nie po nazwach.

Cechy gatunku mają własny, krótszy kształt (`name_race_raceSource_source`), ale
ich z regułami klasy nie porównujemy, więc to bez znaczenia.

Flaga `advancementOrigin` była w tej próbce pusta na wszystkich przedmiotach,
mimo że klasa niosła 9 wpisów Advancement. Nie badane dalej — nasze
dopasowywanie z niej nie korzysta.

### Czego stąd NIE wolno wywnioskować

Że panel opisów i praca przy oknach wyboru straciły sens. Tracą go wyłącznie
na czas, w którym aktywny jest build dla patronów. Na buildzie zwykłym te okna
wracają i wracają z nimi wszyscy, którzy za dostęp nie płacą.
