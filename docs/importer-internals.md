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
