# Sprzątanie — decyzje projektowe

Aplikacja dla pięcioosobowego mieszkania studenckiego: nakładka na istniejący arkusz Excel
z grafikiem sprzątania, która przypomina każdemu, co ma w tym tygodniu do zrobienia.

Ten dokument opisuje **co** budujemy i **dlaczego tak**. Instrukcja wykonania krok po kroku
jest w [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 1. Ustalone wymagania

| Temat | Ustalenie |
|---|---|
| Źródło prawdy | Arkusz Excel (OneDrive/SharePoint, link „każdy z linkiem"). Aplikacja go tylko czyta. |
| Forma | PWA instalowana z przeglądarki. Bez sklepów z aplikacjami. |
| Telefony | Nieznane → projekt musi działać na Androidzie i iPhonie (iOS 16.4+). |
| Kanał | Wyłącznie powiadomienia push w PWA. |
| Zakres | Przypomnienia + przycisk „Zrobione": po odhaczeniu przypomnienia z tego tygodnia milkną, reszta widzi status. |
| Pory | Domyślnie pon 9:00, sob 11:00, ndz 18:00 (czas polski); każdy może zmienić u siebie. |
| Kolumna `???` | Oznacza wolne: widoczna w grafiku, bez przypomnień. |
| Kolumny J–N arkusza | Ignorowane. |
| Dostęp | Tajny kod mieszkania w linku zaproszenia; potem wybór imienia z listy, bez haseł. |
| Bateria | Minimalne zużycie; grafik może być odświeżany rzadko. |
| Zaufanie | Minimalny łańcuch dostaw: brak zależności w kodzie, który trafia na telefony i serwer. |
| Koszt | 0 zł — darmowy plan Cloudflare. |
| Podgląd arkusza | Tak: tabela w aplikacji + link do oryginału. |

## 2. Co wiemy o arkuszu (sprawdzone na żywym pliku)

- Jeden arkusz `Arkusz1`, zakres `A1:N52`. Wiersz 1 to obrazki, wiersz 2 to nagłówki.
- Kolumny: `początek tygodnia`, `koniec tygodnia`, potem zadania w postaci `nazwa (opis)`,
  a na końcu `???`. Po pustych kolumnach H–I jest drugi blok nagłówków (J–N) bez danych.
- 50 tygodni, poniedziałek–niedziela, od 2026‑10‑26 do 2027‑10‑10. Co tydzień każda osoba
  przesuwa się o jedną kolumnę w prawo.
- Imiona w wierszach 4+ to formuły odwołujące się do poprzedniego wiersza. Plik zawiera
  zapisane wyniki formuł, więc nie trzeba ich liczyć.
- **Pobieranie:** link anonimowy działa, ale dwuetapowo: pierwsze żądanie zwraca `302`
  i ciasteczko `FedAuth`, dopiero drugie (z ciasteczkiem) zwraca plik. Bez ciasteczka jest `403`.
  Odpowiedź nie ma nagłówków CORS. **Przeglądarka nie pobierze więc arkusza sama — musi to
  robić serwer.**
- Pobranie trwa ok. 1,4 s, plik ma 130 kB (głównie dwa GIF‑y). Żądanie warunkowe (`If-None-Match`)
  jest ignorowane, zawsze wraca cały plik.
- Popularna biblioteka `openpyxl` wykłada się na stylach tego pliku. Własny parser czytający
  tylko wartości komórek nie ma tego problemu (patrz §3, decyzja 5).
- SharePoint wysyła `X-Frame-Options: SAMEORIGIN`, więc arkusza nie da się osadzić w ramce.

## 3. Decyzje

### 1. Platforma: PWA

| Opcja | Ocena |
|---|---|
| **PWA (wybrane)** | Jeden kod na Androida i iOS, instalacja z linku, brak sklepu, nic „podejrzanego" do instalowania. Push działa na Androidzie od razu, na iOS po dodaniu do ekranu początkowego. |
| Natywna aplikacja Android (APK) | Instalacja spoza sklepu to dokładnie ten scenariusz, którego chcemy uniknąć. Nie obsługuje iPhone'ów. |
| Google Play | 25 USD, weryfikacja tożsamości, a nowe konta prywatne muszą przejść zamknięte testy (wg mojej wiedzy 12 testerów przez 14 dni — sprawdzić przed decyzją). iOS osobno: 99 USD/rok i Mac. |
| Bez aplikacji (kalendarz ICS, bot na czacie) | Najtaniej, ale bez „Zrobione" i bez podglądu. Odrzucone przy zbieraniu wymagań. |

Furtka na przyszłość: gotową PWA można opakować jako TWA i wrzucić do Google Play bez zmian w kodzie.

### 2. Dostarczanie powiadomień: Web Push z serwera

Przeglądarka nie ma niezawodnego sposobu na zaplanowanie powiadomienia „na sobotę 11:00" bez
serwera. Notification Triggers nigdy nie wyszły poza eksperyment, a Periodic Background Sync
działa tylko w Chrome na Androidzie i nie daje gwarancji czasu. Zostaje Web Push: serwer
o właściwej porze wysyła wiadomość, system operacyjny budzi service workera, ten pokazuje
powiadomienie.

### 3. Backend: Cloudflare Workers + D1 + Cron Triggers

Jeden Worker serwuje pliki PWA, API i dwa zadania cron. Stan trzyma baza D1 (SQLite).

Przegląd oferty Cloudflare pod kątem darmowego planu (limity sprawdzone w dokumentacji, listopad 2026):

| Produkt | Darmowy plan | Decyzja |
|---|---|---|
| Workers + pliki statyczne | 100 000 żądań/dzień, pliki statyczne bez limitu, 10 ms CPU na wywołanie, 50 żądań wychodzących na wywołanie | ✔ API i hosting PWA pod jednym adresem |
| Cron Triggers | 5 na konto, rozdzielczość 1 min, czas UTC | ✔ dwa wyzwalacze |
| D1 | 5 mln odczytów i 100 000 zapisów wierszy dziennie, 5 GB | ✔ cały stan |
| KV | 100 000 odczytów, 1 000 zapisów dziennie | ✗ spójność „po czasie" psuje „odhaczam i od razu widzę"; D1 wystarcza |
| Durable Objects (SQLite) | dostępne | ✗ na razie. Alarmy dałyby dokładne budziki, ale dokumentacja nie potwierdza ich limitu na darmowym planie, a cron + D1 jest prostszy |
| Containers | **niedostępne** — tylko plan płatny (5 USD/mies.) | ✗ i tak niepotrzebne: nie mamy procesu działającego w tle ani binarek |

Odrzucone poza Cloudflare: sam GitHub (Actions + Pages) — cron spóźnia się nawet o kilkadziesiąt
minut i nie ma API na subskrypcje ani „Zrobione"; własny serwer — utrzymanie; Google Apps Script —
brak kryptografii potrzebnej do Web Push.

### 4. Źródło grafiku: zostaje Excel na SharePoincie

Działa dziś bez żadnych zmian w arkuszu. Adres arkusza jest jedynym miejscem zależnym od
SharePointa: moduł pobierający ręcznie podąża za przekierowaniami i przenosi ciasteczka, więc
zadziała też z bezpośrednim linkiem do pliku `.xlsx` z innego źródła (np. eksport z Google Sheets —
nietestowane). Reszta systemu widzi tylko gotowy model grafiku (§4), nie arkusz.

### 5. Parser XLSX: własny, bez zależności

Plik XLSX to ZIP z XML‑em. Potrzebujemy wyłącznie wartości komórek pierwszego arkusza, więc
wystarcza ok. 130 linii na standardowych API (`DecompressionStream`, wyrażenia regularne).
Alternatywa — SheetJS — to duża zależność, której wersja w npm jest od lat nieaktualizowana.
Parser jest napisany i przetestowany na prawdziwym pliku.

### 6. Web Push: własna implementacja na WebCrypto

Szyfrowanie wiadomości (RFC 8291) i podpis VAPID (RFC 8292) to ok. 120 linii na wbudowanym
WebCrypto. Implementacja odtwarza przykład z RFC 8291 bajt w bajt. Zero paczek npm na serwerze.

### 7. Tożsamość: kod mieszkania + wybór imienia

Link zaproszenia `https://…/?k=KOD` (np. jako QR na lodówce). API bez kodu nie zwraca nic.
Każdy wybiera imię z listy z arkusza. Kto zna kod, może odhaczyć też cudze zadanie — aplikacja
zapisuje, kto to zrobił. Świadomie nie ma kont ani haseł: to pięć osób, które sobie ufają.

### 8. „Zrobione": w bazie aplikacji

Zapis do Excela wymagałby logowania do Microsoft Graph. Stan odhaczeń żyje więc w D1,
a arkusz pozostaje tylko do odczytu.

### 9. Frontend: czysty JavaScript, bez frameworka i bez kroku budowania

Cztery ekrany nie uzasadniają frameworka. Moduły ES serwowane wprost, ręcznie napisany service
worker, żadnych skryptów z CDN. Jedyna zależność deweloperska to `wrangler` (oficjalne narzędzie
Cloudflare), który nie trafia ani na serwer, ani na telefony.

### 10. Podgląd arkusza: własna tabela + link do oryginału

Tabela rysowana z modelu grafiku działa offline, podświetla bieżący tydzień i „moje" komórki.
Obok przycisk „Otwórz arkusz w Excelu". Osadzenie oryginału w ramce jest zablokowane przez SharePoint.

## 4. Architektura

```
        telefon (PWA)                         Cloudflare (darmowy plan)
┌──────────────────────────┐        ┌─────────────────────────────────────────┐
│ strona: Ten tydzień,     │  HTTPS │ Worker                                  │
│ Grafik, Ustawienia       │◄──────►│  ├─ pliki statyczne PWA                 │
│                          │  /api  │  ├─ /api/*  (kod mieszkania)            │
│ service worker:          │        │  ├─ cron co 15 min: kto ma przypomnienie│
│  - cache powłoki         │        │  └─ cron co 6 h: pobierz i sparsuj Excel│
│  - push → powiadomienie  │        │ D1: grafik (JSON), subskrypcje,         │
└────────────▲─────────────┘        │     ustawienia, zrobione, wysłane       │
             │ push                 └───────┬──────────────────────┬──────────┘
   ┌─────────┴──────────┐   Web Push        │                      │ HTTPS + ciasteczko
   │ FCM / APNs / Mozilla│◄─────────────────┘                      ▼
   └────────────────────┘                              SharePoint (arkusz .xlsx)
```

Model grafiku, którym posługuje się cała reszta systemu:

```json
{
  "tasks":  [{ "key": "lazienka", "title": "łazienka", "details": "odkurzyć podłogę, …", "free": false }],
  "people": ["Ala", "Bartek", "Celina", "Darek", "Ewa"],
  "weeks":  [{ "start": "2026-11-09", "end": "2026-11-15", "assignees": ["Darek", "Ewa", "Ala", "Bartek", "Celina"] }],
  "warnings": []
}
```

`assignees[i]` to osoba przypisana do `tasks[i]` w danym tygodniu.

## 5. Bateria: PWA czy aplikacja natywna?

Krótko: **różnica jest niemierzalna, a projekt i tak zużywa prawie nic.**

- Baterię zjadają wybudzenia i radio. W tym projekcie telefon nie robi w tle nic: żadnego
  odpytywania, żadnej synchronizacji okresowej.
- Web Push korzysta z jednego, stałego połączenia systemowego (FCM w Usługach Google Play,
  APNs na iOS), które działa niezależnie od naszej aplikacji. Aplikacja natywna użyłaby
  dokładnie tego samego kanału.
- Koszt po naszej stronie to wybudzenie service workera na ułamek sekundy, do ok. trzech razy
  w tygodniu na osobę.
- Aplikacja natywna mogłaby planować lokalne alarmy bez serwera, ale wtedy sama musiałaby
  okresowo pobierać arkusz — czyli budziłaby telefon częściej, nie rzadziej.
- **Częstotliwość odświeżania arkusza nie ma wpływu na baterię**, bo odświeża serwer. Dlatego
  serwer robi to co 6 godzin (zamiast co kilka dni), a w aplikacji jest przycisk „Odśwież".
- Zwykłe przypomnienia idą z priorytetem `normal`, więc system może je dostarczyć przy
  najbliższym wybudzeniu telefonu, zamiast budzić go specjalnie. Tylko „ostatni dzwonek" idzie jako `high`.
- Strona pobiera stan tylko wtedy, gdy ktoś ją otworzy.

## 6. Arkusz: zalecenia

Nic nie trzeba zmieniać. Parser kotwiczy się na tekstach nagłówków, nie na adresach komórek,
więc zniesie dodanie wierszy nad tabelą czy przesunięcie jej w bok.

Umowa z arkuszem:

1. Komórki `początek tygodnia` i `koniec tygodnia` zostają z tymi nazwami.
2. Zadania to kolejne niepuste nagłówki na prawo od nich. Pierwsza pusta kolumna kończy listę.
3. Nagłówek `nazwa (opis)`: nazwa trafia do tytułu powiadomienia, opis do treści.
4. Nagłówek `???` (albo `wolne`) oznacza wolne. Wpisanie tam prawdziwej nazwy automatycznie
   włącza przypomnienia dla piątego zadania.
5. Imiona muszą być pisane identycznie w całym arkuszu — to po nich aplikacja rozpoznaje osoby.

Dwie rzeczy warte wiedzy, niezależnie od aplikacji:

- **Jednorazowa zamiana psuje resztę roku.** Każdy wiersz liczy się z poprzedniego, więc
  ręczne wpisanie innego imienia w jednym tygodniu przesuwa rotację we wszystkich następnych.
  Odporna wersja formuły liczy z listy imion w `J2:N2` zamiast z wiersza wyżej, np. w `C3`
  i przeciągnięta na cały zakres: `=INDEKS($J$2:$N$2;MOD(NR.KOLUMNY()-WIERSZ();5)+1)`.
  Wtedy zamiana w jednym tygodniu nie wpływa na kolejne.
- **Plik leży na studenckim koncie uczelnianym.** Gdy konto wygaśnie albo uczelnia zmieni
  zasady udostępniania, link przestanie działać. Aplikacja pokaże wtedy ostrzeżenie i będzie
  pracować na ostatniej dobrej kopii; trzeba będzie przenieść plik i podmienić jeden sekret (`SHEET_URL`).

## 7. Bezpieczeństwo i prywatność

- W repozytorium nie ma imion, adresu arkusza, kodu mieszkania ani kluczy. Dane testowe mają
  zmyślone imiona. Sekrety żyją w Cloudflare (`wrangler secret`).
- Kod mieszkania ma ok. 80 bitów losowości, więc zgadywanie przez sieć jest nierealne.
- Treść z arkusza jest traktowana jako niezaufana (link może pozwalać na edycję): na stronie
  trafia wyłącznie przez `textContent`, obowiązuje ścisłe Content‑Security‑Policy bez
  zewnętrznych źródeł.
- Serwer wysyła push wyłącznie do znanych usług (Google, Apple, Mozilla, Microsoft), żeby nie
  dało się go użyć do wysyłania żądań pod dowolny adres.
- `Referrer-Policy: no-referrer`, bo kod bywa w adresie zaproszenia.
- Błędny lub nieczytelny arkusz nigdy nie nadpisuje ostatniej dobrej wersji grafiku.

## 8. Ryzyka i plany B

| Ryzyko | Skutek | Zabezpieczenie |
|---|---|---|
| Limit 10 ms CPU na darmowym planie | Parsowanie arkusza (3,5 ms w Node po rozgrzaniu, więcej na zimno) mogłoby zostać ubite | Osobne wywołanie cron tylko na parsowanie; pomiar po wdrożeniu. Plan B: parsować w GitHub Actions tym samym kodem i wgrywać gotowy JSON do Workera |
| iPhone: push tylko w zainstalowanej PWA | Ktoś otworzy link w Safari i nie dostanie powiadomień | Ekran powitalny wykrywa iOS i prowadzi przez „Do ekranu początkowego"; przycisk „Wyślij testowe" |
| iPhone: osobna pamięć Safari i zainstalowanej apki | Po instalacji aplikacja nie zna kodu | Kod przenoszony w `start_url` manifestu, a jako pewna ścieżka — ręczne wpisanie kodu |
| Subskrypcja push po cichu wygasa | Brak powiadomień bez żadnego błędu | Aplikacja przy każdym otwarciu sprawdza i odnawia subskrypcję; serwer usuwa martwe |
| Link do arkusza przestaje działać | Grafik się nie odświeża | Ostatnia dobra kopia + baner z datą; podmiana `SHEET_URL` |
| Oszczędzanie baterii producenta (Xiaomi, Huawei…) | Opóźnione powiadomienia | „Ostatni dzwonek" z priorytetem `high`; wskazówka w README |
| Nie da się przetestować push bez prawdziwego telefonu | Błąd wyjdzie dopiero u ludzi | Push jest wcześnie w planie (M3) i ma własny przycisk testowy |

## 9. Do rozważenia w przyszłości

### Aplikacja sama planuje zmiany (bez arkusza)

Zamiast czytać Excel, aplikacja trzymałaby u siebie listę osób, listę zadań, regułę rotacji
i wyjątki (zamiany, nieobecności), a grafik wyliczała sama.

| Zyskujemy | Tracimy / trzeba zbudować |
|---|---|
| Znika zależność od SharePointa, ciasteczek, parsera i limitu CPU | Edytor grafiku — dziś Excel daje go za darmo |
| Zamiana działa natychmiast i może powiadomić obie strony | Historia zmian i cofanie („kto to przestawił?") |
| Nieobecności, urlopy, statystyki sprawiedliwości | Mocniejsza kontrola, kto może edytować |
| Brak pułapki z formułą kaskadową | Swoboda arkusza: notatki, kolory, doraźne poprawki |

Architektura jest na to przygotowana: wszystko poza jednym modułem widzi tylko model grafiku
z §4. Wymiana źródła to nowy moduł, który ten model produkuje, plus interfejs do edycji —
API, przypomnienia i ekrany zostają.

**Krok pośredni, znacznie tańszy:** arkusz zostaje bazą, a aplikacja przechowuje nakładkę
jednorazowych zamian (`grafik efektywny = arkusz + zamiany`). Rozwiązuje problem zamian bez
budowania pełnego edytora. Dobry moment na to: kiedy zamiany przez Excela zaczną uwierać albo
gdy link do arkusza pierwszy raz padnie.

### Pozostałe pomysły

- Powiadomienie „grafik się zmienił" dla osób, którym zmieniło się zadanie w bieżącym tygodniu.
- „Wytykanie": wiadomość do wszystkich, gdy ktoś nie odhaczył do końca tygodnia.
- Historia i statystyki (kto ile razy zrobił na czas).
- Subskrypcja kalendarza (ICS) jako zapasowy kanał.
- Publikacja w Google Play jako TWA.
