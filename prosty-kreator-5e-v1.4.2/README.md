# Character Creator (D&D 5e) — 1.1.0

Guided character creation for Foundry VTT that **drives the tools you already
have** instead of replacing them.

- Foundry: **v13 or v14**
- System: **dnd5e 5.0+** (developed against 5.3)

---

## Co robi

Kreator nie implementuje własnego wyboru gatunku, klasy, ekwipunku ani zaklęć.
Każdy krok klika **ten sam przycisk, który jest na karcie postaci**, więc
uruchamia się dokładnie to, co masz zainstalowane — Plutonium, systemowy
Compendium Browser, mechanizm Advancement. Moduł dokłada kolejność, kontekst dla
gracza i jedną rzecz, którą importery pomijają: **atrybuty**.

### Dwa narzędzia

**New Character** (zakładka Aktorzy) — panel z pięcioma krokami: imię, gatunek,
pochodzenie, klasa, atrybuty i języki. Panel obserwuje kartę i odhacza kroki
sam, gdy coś na niej wyląduje. Okna Plutonium pojawiają się na wierzchu —
zamykasz je i wracasz do panelu.

**Complete Character** (przycisk na karcie, w trybie edycji) — przypisuje
atrybuty i języki istniejącej postaci. Rozpoznaje premie już naliczone na karcie
i pokazuje wynik przed zapisem.

---

## Uprawnienia dla graczy

Gracz potrzebuje uprawnienia **Create New Actors**:
*Ustawienia → Konfiguruj Uprawnienia → Create New Actors*.
Bez tego przycisk zgłosi błąd. Można też całkiem wyłączyć dostęp graczy w
ustawieniach modułu.

---

## Ustawienia

- **Panel: opening paragraph** i cztery pola na teksty kroków — własne
  instrukcje dla graczy, bez dotykania plików. Puste = tekst domyślny.
- **Show 'New Character' in the Actors sidebar**
- **Show buttons on the character sheet**
- **Also show 'Complete Character' in the sidebar** — awaryjne, gdyby przyciski
  na karcie nie zadziałały w Twojej wersji arkusza.
- **Narrow tooltips in the Compendium Browser** — zawęża obszar wyzwalający
  podgląd, żeby dymek nie zasłaniał checkboxa. Ingeruje w cudzy interfejs;
  wyłącz, jeśli coś wygląda źle.
- **Players may start a new character**

---

## Sprawdzenie gotowości

Panel weryfikuje kartę i rozdziela problemy na blokujące (brak gatunku,
pochodzenia, klasy, zerowe HP, zerowa szybkość, nieprzypisane atrybuty) oraz
warte sprawdzenia (języki, biegłości, ekwipunek, portret).

---

## Wejścia awaryjne

```js
characterCreator.guide()            // nowa postać
characterCreator.resume(actorId)    // powrót do przerwanej
characterCreator.complete(actorId)  // atrybuty i języki
```

---

## Ograniczenia

- Kreator zakłada **poziom 1**. Awanse prowadzi karta postaci.
- Wykrywanie premii do atrybutów: przy pierwszym uruchomieniu na karcie bez
  historii czyta advancementy, a gdy ich nie ma, przyjmuje że wszystko powyżej
  10 to premia. Dlatego wynik jest pokazywany przed zapisem.
- Ekwipunek startowy dodaje Plutonium albo systemowy mechanizm — moduł go nie
  dotyka.

---

## Gdy coś nie działa

**F12 → Console**, powtórz czynność, skopiuj czerwony błąd. Przydaje się też
wersja Foundry i dnd5e (*Ustawienia → Wsparcie i Zgłaszanie Błędów*).

Po aktualizacji plików na serwerze: `git pull`, potem **Ctrl+Shift+R** w
przeglądarce. Numer wersji w liście modułów odświeża się dopiero po restarcie
serwera Foundry — sam kod ładuje się przy odświeżeniu strony.
