# Plan implementacji

Dokument dla wykonawcy (człowieka lub modelu), który nie zna wcześniejszych ustaleń.
Uzasadnienia decyzji są w [DESIGN.md](DESIGN.md) — przeczytaj go najpierw, zwłaszcza §1 i §3.

Budujemy PWA „Sprzątanie": czyta grafik sprzątania z arkusza Excel i wysyła przypomnienia push.
Całość działa na jednym Cloudflare Workerze (darmowy plan) z bazą D1.

## 0. Zasady twarde

1. **Zero zależności w kodzie produkcyjnym** — ani w `src/`, ani w `public/`. Żadnych paczek
   npm, frameworków, bundlerów, skryptów ani czcionek z CDN. Jedyna dozwolona zależność
   deweloperska to `wrangler`, przypięty do dokładnej wersji, z commitowanym `package-lock.json`.
2. **Nie przepisuj modułów w `src/core/`**, które już istnieją (§1). Są zweryfikowane. Jeśli
   musisz je zmienić, najpierw dodaj test pokazujący potrzebę.
3. **Żadnych danych osobowych ani sekretów w repozytorium**: prawdziwych imion, adresu
   arkusza, kodu mieszkania, klucza prywatnego VAPID. W testach i przykładach używaj imion
   Ala, Bartek, Celina, Darek, Ewa.
4. **Dane z arkusza są niezaufane.** Na stronie wstawiaj je wyłącznie przez `textContent`
   lub `createElement`. Nigdy `innerHTML` z danymi.
5. **Każde zdarzenie `push` musi pokazać powiadomienie.** Ciche pushe powodują cofnięcie
   subskrypcji przez przeglądarkę.
6. **Telefon nie robi nic w tle**: bez odpytywania, bez Background Sync, bez timerów.
   Strona pobiera stan tylko przy otwarciu lub powrocie na pierwszy plan.
7. Logika jest w czystych funkcjach z testami (`node --test`). Czas i `fetch` są wstrzykiwane,
   nigdy brane globalnie wewnątrz logiki.
8. Komentarze i identyfikatory w kodzie po angielsku; teksty interfejsu po polsku.
9. Po każdym kamieniu milowym: `npm test` zielone, osobny commit.

## 1. Stan wyjściowy — gotowe i przetestowane

`npm test` uruchamia 18 testów, wszystkie przechodzą. Wymagany Node ≥ 22.13.

| Plik | Co robi | Jak zweryfikowano |
|---|---|---|
| `src/core/sheet-fetch.js` | `downloadWorkbook(url)` — pobiera plik zza linku SharePoint, ręcznie podążając za przekierowaniem i przenosząc ciasteczka | Na żywym linku oraz testami z atrapą `fetch` |
| `src/core/xlsx.js` | `readFirstSheet(bytes)` — ZIP + XML → wiersze z wartościami komórek | Na prawdziwym pliku z Excel Online |
| `src/core/schedule.js` | `buildSchedule(rows)`, `weekFor()`, `tasksFor()` — wiersze → model grafiku | Jak wyżej + przypadki brzegowe |
| `src/core/webpush.js` | `sendPush()`, `encryptPayload()`, `vapidAuthorization()`, `generateVapidKeys()` | Odtwarza przykład z RFC 8291 bajt w bajt; podpis VAPID weryfikowany kluczem publicznym |
| `src/core/time.js` | `localParts()`, `slotsBetween()`, `isoWeekday()` — czas lokalny w strefie mieszkania | Testy ze zmianą czasu w obie strony |
| `migrations/0001_init.sql` | Schemat D1 | Ładowany przez atrapę D1 w testach |
| `test/helpers/d1.js` | `createD1()` — atrapa D1 w pamięci na wbudowanym `node:sqlite` | Test `test/d1.test.js` |
| `test/fixtures/grafik.xlsx` | Prawdziwy układ arkusza ze zmyślonymi imionami | — |
| `scripts/gen-vapid.js` | Generuje parę kluczy VAPID | Uruchomiony ręcznie |

Wszystkie moduły `src/core/` używają wyłącznie standardowych API (`fetch`, WebCrypto,
`DecompressionStream`, `Intl`), więc ten sam kod działa w Workerze i w Node.

**Czego nie dało się sprawdzić:** dostarczenia powiadomienia na prawdziwy telefon oraz
zachowania w środowisku Cloudflare (limit CPU). Dlatego push jest wcześnie w planie (M3).

## 2. Docelowa struktura

```
wrangler.jsonc
package.json, package-lock.json
migrations/0001_init.sql
src/
  worker.js            punkt wejścia: tylko spina zależności
  app.js               router, autoryzacja, odpowiedzi JSON
  handlers.js          obsługa poszczególnych endpointów
  store.js             cały SQL w jednym miejscu
  refresh.js           arkusz → meta.schedule_json
  tick.js              cron: wybór i wysyłka przypomnień
  core/
    reminders.js       DO NAPISANIA: reguły, dueReminders(), buildNotification()
    (pozostałe już są)
public/
  index.html, style.css, sw.js, _headers
  app.js, api.js, push.js, views/{onboarding,today,schedule,settings}.js
  icons/{icon-192,icon-512,maskable-512,apple-touch-icon,badge-96}.png
scripts/gen-vapid.js, scripts/gen-flat-code.js
test/*.test.js, test/helpers/d1.js, test/fixtures/grafik.xlsx
```

## 3. Konfiguracja

`wrangler.jsonc` — szablon; **sprawdź nazwy kluczy w aktualnej dokumentacji**
(<https://developers.cloudflare.com/workers/wrangler/configuration/>,
<https://developers.cloudflare.com/workers/static-assets/>):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "sprzatanie",
  "main": "src/worker.js",
  "compatibility_date": "<data dnia implementacji>",
  "assets": { "directory": "./public" },
  "d1_databases": [
    { "binding": "DB", "database_name": "sprzatanie", "database_id": "<uzupełnia właściciel>", "migrations_dir": "migrations" }
  ],
  "triggers": { "crons": ["*/15 * * * *", "7 */6 * * *"] },
  "vars": { "TIMEZONE": "Europe/Warsaw", "VAPID_PUBLIC_KEY": "", "VAPID_SUBJECT": "" },
  "observability": { "enabled": true }
}
```

Nie ustawiaj trybu SPA dla plików statycznych — aplikacja ma jedną stronę i nawigację
po `#/…`. Żądania niepasujące do pliku statycznego (czyli `/api/*`) trafiają do Workera.

| Zmienna | Rodzaj | Znaczenie |
|---|---|---|
| `FLAT_CODE` | sekret | Kod mieszkania, małe litery, cyfry i myślniki, np. `k3m7-x9qa-2bfw-h8nd` |
| `SHEET_URL` | sekret | Link udostępniania arkusza |
| `VAPID_PRIVATE_KEY` | sekret | Z `scripts/gen-vapid.js` |
| `VAPID_PUBLIC_KEY` | zmienna | Z `scripts/gen-vapid.js` |
| `VAPID_SUBJECT` | zmienna | Adres aplikacji, np. `https://sprzatanie.example.workers.dev`. Jeśli Apple odrzuca push z `403 BadJwtToken`, zmień na `mailto:` |
| `TIMEZONE` | zmienna | `Europe/Warsaw` |

Lokalnie sekrety idą do `.dev.vars` (jest w `.gitignore`).

Punkt wejścia — zależności wstrzykiwane, żeby testy mogły je podmienić:

```js
import { handleRequest, handleScheduled } from './app.js';

const deps = { fetch: (...args) => fetch(...args), now: () => Date.now() };

export default {
  fetch: (request, env, ctx) => handleRequest(request, env, ctx, deps),
  scheduled: (controller, env, ctx) => ctx.waitUntil(handleScheduled(controller, env, deps)),
};
```

Testy wywołują `handleRequest` i `handleScheduled` bezpośrednio, z `env.DB = createD1()`
i atrapą `deps.fetch`.

## 4. Dane

Model grafiku jest opisany w DESIGN.md §4; produkuje go `buildSchedule()`.

Tabele D1 (`migrations/0001_init.sql`):

| Tabela | Zawartość |
|---|---|
| `meta` | Pojedyncze wartości: `schedule_json`, `schedule_fetched_at`, `schedule_attempt_at`, `schedule_error`, `last_tick` |
| `subscriptions` | Jedna subskrypcja push na urządzenie; klucz: `endpoint` |
| `prefs` | Reguły przypomnień danej osoby (JSON). Brak wiersza = domyślne |
| `done` | Odhaczone zadania; klucz: `(week_start, task_key)` |
| `sent` | Zajęte klucze wysyłki; klucz główny zapobiega duplikatom |

## 5. API

Wszystkie ścieżki pod `/api`. Poza manifestem każda wymaga nagłówka
`Authorization: Bearer <kod>`. Kod porównuj po `trim().toLowerCase()`, w stałym czasie
(porównanie skrótów SHA‑256 bajt po bajcie; nie używaj API dostępnego tylko w Workers).

Odpowiedzi to JSON z `Cache-Control: no-store`. Błąd: `{ "error": "<kod>", "message": "<po polsku>" }`.
Nagłówki bezpieczeństwa z `public/_headers` nie obejmują odpowiedzi Workera — ustaw
`X-Content-Type-Options: nosniff` i `Referrer-Policy: no-referrer` w kodzie.

| Metoda i ścieżka | Wejście | Wynik |
|---|---|---|
| `GET /api/state` | — | Stan (niżej). Jeśli grafiku jeszcze nie ma w bazie, najpierw go pobierz |
| `POST /api/refresh` | — | Stan. Jeśli ostatnia próba była < 60 s temu, zwróć stan bez pobierania |
| `GET /api/prefs?person=` | — | `{ person, rules, isDefault }` |
| `PUT /api/prefs` | `{ person, rules }` | To samo. `rules: null` przywraca domyślne, `[]` wyłącza przypomnienia |
| `POST /api/subscriptions` | `{ person, subscription }` | `{ ok: true }`. Upsert po `endpoint` |
| `DELETE /api/subscriptions` | `{ endpoint }` | `{ ok: true }` |
| `POST /api/push-test` | `{ endpoint }` | `{ ok, status }`. Przy `404`/`410` usuń subskrypcję i zwróć `{ ok: false, gone: true }` |
| `POST /api/done` | `{ weekStart, taskKey, by }` | `{ done: [...] }` |
| `DELETE /api/done` | `{ weekStart, taskKey }` | `{ done: [...] }` |
| `GET /api/manifest?k=` | bez autoryzacji | Manifest PWA (§7) |

Stan:

```json
{
  "now": 1794427200000,
  "today": "2026-11-11",
  "timezone": "Europe/Warsaw",
  "schedule": { "tasks": [], "people": [], "weeks": [], "warnings": [] },
  "sheet": { "fetchedAt": 1794420000000, "error": null, "url": "<SHEET_URL>" },
  "done": [{ "weekStart": "2026-11-09", "taskKey": "lazienka", "by": "Ewa", "at": 1794425000000 }],
  "vapidPublicKey": "B…",
  "defaultRules": [{ "dow": 1, "time": "09:00" }, { "dow": 6, "time": "11:00" }, { "dow": 7, "time": "18:00" }]
}
```

`done` obejmuje ostatnie 8 tygodni.

Walidacja (każdy błąd to `400` z czytelnym komunikatem):

- `person` i `by` muszą być w `schedule.people`.
- `subscription.endpoint`: adres `https:` na hoście `fcm.googleapis.com`,
  `updates.push.services.mozilla.com` albo z końcówką `.push.apple.com` lub
  `.notify.windows.com`. Inny host → `400 unsupported_push_service` z nazwą hosta w komunikacie.
- `subscription.keys.p256dh` dekoduje się do 65 bajtów, `auth` do 16.
- `rules`: najwyżej 10 pozycji; `dow` od 1 (pon) do 7 (ndz); `time` w formacie `HH:MM`
  z minutami `00`, `15`, `30` lub `45`.
- `done`: tydzień musi istnieć i `weekStart <= today`; zadanie musi istnieć i nie być wolnym.
- Treść żądania większa niż 8 kB → `413`.

## 6. Logika serwera

### 6.1 Odświeżanie grafiku — `src/refresh.js`

Wywoływane przez cron `7 */6 * * *`, przez `POST /api/refresh` i przy pierwszym `GET /api/state`.

1. Zapisz `schedule_attempt_at`.
2. `downloadWorkbook(env.SHEET_URL, { fetch: deps.fetch })` → `readFirstSheet` → `buildSchedule`.
3. Sprawdź wynik: 1–20 osób, 1–20 zadań, co najmniej 1 tydzień, imiona i tytuły do 60 znaków,
   JSON do 200 kB.
4. Sukces: zapisz `schedule_json`, `schedule_fetched_at`, usuń `schedule_error`.
5. Dowolny błąd: zapisz `schedule_error` (komunikat i czas) i **zostaw poprzedni `schedule_json` bez zmian**.
6. W wywołaniu cron dodatkowo usuń z `sent` wiersze starsze niż 30 dni.

To wywołanie cron nie robi nic więcej — limit to 10 ms CPU, a parsowanie jest najdroższą operacją.

### 6.2 Reguły i wybór przypomnień — `src/core/reminders.js` (czysta logika)

```js
export const DEFAULT_RULES = [{ dow: 1, time: '09:00' }, { dow: 6, time: '11:00' }, { dow: 7, time: '18:00' }];

/** Zwraca znormalizowane reguły albo rzuca Error z polskim komunikatem. */
export function validateRules(input) {}

/**
 * @param {{ schedule, rulesByPerson: Map<string, Rule[]>, done: Set<string>, fromMs: number, toMs: number, timeZone: string }} input
 *        done zawiera klucze `${weekStart}|${taskKey}`
 * @returns {{ person, weekStart, weekEnd, task, kind: 'start'|'nudge'|'last', daysLeft, slotMs, dedupeKey }[]}
 */
export function dueReminders(input) {}

/** @returns {{ title, body, tag, url, data: { weekStart, taskKey, person } }} */
export function buildNotification(reminder) {}
```

Algorytm `dueReminders`:

1. Dla każdej chwili `t` z `slotsBetween(fromMs, toMs)`: `local = localParts(t, timeZone)`.
2. `week = weekFor(schedule, local.date)`. Brak tygodnia → pomiń chwilę.
3. Dla każdej osoby z `rulesByPerson` i każdej jej reguły, gdzie `rule.dow === local.dow`
   i `rule.time === local.time`:
4. Dla każdego zadania z `tasksFor(schedule, week, person)` (wolne już są odfiltrowane),
   którego klucz `${week.start}|${task.key}` nie jest w `done`, dodaj przypomnienie.
5. `dedupeKey = ${week.start}|${task.key}|${person}|${local.date}T${local.time}`.
6. `daysLeft` = liczba dni od `local.date` do `week.end`.
7. `kind`: posortuj reguły osoby według `(rule.dow - isoWeekday(week.start) + 7) % 7`, potem
   według `time`. Pierwsza → `start`; ostatnia, jeśli reguł jest więcej niż jedna → `last`;
   pozostałe → `nudge`.

Wynik nie może zawierać dwóch pozycji z tym samym `dedupeKey` (jesienna zmiana czasu powtarza
godzinę 2:00–3:00).

`buildNotification`:

| `kind` | `title` |
|---|---|
| `start` | `Twój dyżur: {task.title}` |
| `nudge` | `Przypomnienie: {task.title}` |
| `last` | `Ostatni dzwonek: {task.title}` |

`body` = `{task.details} · {termin}`, a przy pustym opisie samo `{termin}`, gdzie termin to:
`termin mija dziś` (0 dni), `termin mija jutro` (1 dzień), w pozostałych przypadkach
`termin: DD.MM`. `tag` = `${weekStart}|${task.key}`. `url` = `/`.

Wymagane testy (grafik z `test/fixtures/grafik.xlsx`, strefa `Europe/Warsaw`):

- Poniedziałek 2026‑11‑09 09:00 czasu polskiego (08:00 UTC) → cztery przypomnienia `start`;
  osoba z kolumny wolnej nie dostaje nic.
- Zadanie w `done` → brak przypomnienia.
- Okno obejmujące kilka chwil (nadrabianie po przerwie) → każde przypomnienie raz.
- Własne reguły osoby; pusta lista → nic.
- Osoba spoza bieżącego tygodnia → nic. Data poza zakresem arkusza → nic.
- Lato: poniedziałek 09:00 czasu polskiego to 07:00 UTC.
- Reguła o 02:30 w dniu 2027‑10‑31 → dokładnie jedno przypomnienie.
- Kolejność `kind` także dla tygodnia, który nie zaczyna się w poniedziałek.
- Treść `body` dla 0, 1 i 3 dni do końca oraz dla pustego opisu.

### 6.3 Cron co 15 minut — `src/tick.js`

1. `now = controller.scheduledTime`. `last = meta.last_tick` (gdy brak: `now - 15 min`).
   `from = max(last, now - 3 h)` — po długiej awarii nie wysyłamy starych przypomnień.
2. Wczytaj grafik; brak → zapisz `last_tick` i zakończ.
3. Wczytaj subskrypcje i pogrupuj po osobie; osoby bez subskrypcji pomiń. Dla pozostałych
   weź reguły z `prefs` albo `DEFAULT_RULES`.
4. Wczytaj `done` z ostatnich 3 tygodni.
5. `dueReminders(...)`.
6. Dla każdego przypomnienia zajmij klucz:
   `INSERT OR IGNORE INTO sent (dedupe_key, sent_at) VALUES (?, ?)`. Jeśli `meta.changes === 0`,
   ktoś już je wysłał → pomiń.
7. Wyślij `sendPush(...)` na każdą subskrypcję osoby (`Promise.allSettled`):
   - `urgency`: `high` dla `last`, w pozostałych `normal`; `ttl`: 86400.
   - `topic`: pierwsze 32 znaki `b64url(SHA‑256("${weekStart}|${task.key}|${person}"))` —
     dzięki temu usługa push zastąpi niedostarczone starsze przypomnienie o tym samym zadaniu nowszym.
   - Treść: wynik `buildNotification` jako JSON.
   - `gone` → usuń subskrypcję. Sukces → `last_ok_at = now`, `fail_count = 0`.
     Inny błąd → `fail_count + 1`.
   - Nagłówek VAPID licz raz na host usługi push w obrębie jednego wywołania.
8. Jeśli **żadna** subskrypcja osoby nie przyjęła wiadomości i nie chodziło o `gone`, usuń
   zajęty klucz z `sent` — następne wywołanie spróbuje ponownie (okno 3 h ogranicza liczbę prób).
9. Zapisz `last_tick = now`.

`handleScheduled` rozróżnia zadania po `controller.cron` (dokładnie te same napisy, co w konfiguracji).

Wymagane testy (atrapa D1, atrapa `fetch`, ustalony czas):

- Dwa wywołania z rzędu wysyłają przypomnienie raz.
- Wywołanie po godzinnej przerwie nadrabia pominiętą chwilę; po przerwie dłuższej niż 3 h
  starsze przypomnienia przepadają.
- `410` usuwa subskrypcję.
- Wszystkie wysyłki zakończone `500` → klucz znika z `sent`, kolejne wywołanie ponawia.
- Zadanie odhaczone → brak wysyłki.
- Osoba z dwoma urządzeniami dostaje wiadomość na oba.

## 7. Frontend

### Powłoka

- `index.html`: `lang="pl"`, `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
  `theme-color`, `<link rel="manifest" href="/api/manifest">`, `<link rel="apple-touch-icon">`,
  jeden `<script type="module" src="/app.js">`.
- Jasny i ciemny motyw przez `prefers-color-scheme`. Cele dotykowe co najmniej 44 px.
- Nawigacja po `location.hash`: `#/` (Ten tydzień), `#/grafik`, `#/ustawienia`. Dolny pasek z trzema zakładkami.
- `public/_headers`:

```
/*
  Content-Security-Policy: default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Robots-Tag: noindex
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
```

### Manifest — `GET /api/manifest?k=`

`name: "Sprzątanie"`, `short_name: "Sprzątanie"`, `lang: "pl"`, `display: "standalone"`,
`id: "/"`, `scope: "/"`, ikony 192, 512 i maskable 512, `background_color`, `theme_color`.
`start_url` to `/?k=<kod>`, gdy `k` pasuje do `^[a-z0-9-]{1,64}$`, w przeciwnym razie `/`.
Typ `application/manifest+json`. Endpoint nie sprawdza poprawności kodu.

Po co: na iPhonie zainstalowana PWA ma osobną pamięć niż Safari, więc kod zapisany przed
instalacją by przepadł. Gdy strona zna kod, podmienia `href` manifestu na `/api/manifest?k=<kod>`.
To rozwiązanie „najlepiej jak się da" — pewną ścieżką jest ręczne wpisanie kodu.

### Pamięć po stronie klienta

- `localStorage`: `flatCode`, `person`, `lastState` (ostatnia odpowiedź `/api/state`, do
  natychmiastowego i offline'owego wyświetlenia), `subscriptionSyncedAt`.
- Service worker nie ma dostępu do `localStorage`. Kopię `{ flatCode, person }` zapisuj więc
  też w Cache Storage: `caches.open('config')` → `put('/__config', new Response(JSON.stringify(cfg)))`.

### Start aplikacji

1. Jeśli w adresie jest `?k=`, zapisz kod i usuń parametr przez `history.replaceState`.
2. Zarejestruj `/sw.js`.
3. Pokaż `lastState`, jeśli jest; równolegle pobierz `/api/state`.
4. `401` → wyczyść kod i pokaż ekran „Kod mieszkania". Brak sieci → baner offline.
5. Brak kodu, osoby albo osoba spoza `schedule.people` → ekran powitalny.
6. Jeśli zgoda na powiadomienia jest udzielona: `pushManager.getSubscription()`; gdy `null` —
   zasubskrybuj ponownie; wyślij `POST /api/subscriptions`, gdy zmienił się `endpoint` albo
   minęła doba od `subscriptionSyncedAt`. To samonaprawa po cichym wygaśnięciu subskrypcji.
7. Odświeżaj stan przy `visibilitychange` na `visible`, nie częściej niż co 5 minut.

### Ekran powitalny

1. **Kod mieszkania** — pole i „Dalej". Pomijany, gdy kod przyszedł w linku. Kod sprawdzasz
   wywołaniem `/api/state`; `401` → „Nieprawidłowy kod".
2. **Kim jesteś?** — przycisk na każde imię z `schedule.people`.
3. **Powiadomienia** — zależnie od urządzenia:
   - iOS poza trybem standalone: instrukcja „Na iPhonie powiadomienia działają dopiero po
     dodaniu aplikacji do ekranu początkowego: 1. Stuknij Udostępnij. 2. Wybierz „Do ekranu
     początkowego". 3. Otwórz Sprzątanie z ekranu początkowego." Bez przycisku włączania.
   - Brak `PushManager`: „Ta przeglądarka nie obsługuje powiadomień. Otwórz stronę w Chrome
     (Android) albo w Safari (iPhone)."
   - W pozostałych: przycisk „Włącz powiadomienia". Po zgodzie: subskrypcja, zapis na
     serwerze, automatyczny `POST /api/push-test`. Po odmowie: krótka instrukcja odblokowania.
   - Na Androidzie, gdy przechwycono `beforeinstallprompt`: przycisk „Zainstaluj aplikację".
   - Zawsze link „Pomiń".

Wykrywanie: iOS to `/iPad|iPhone|iPod/.test(navigator.userAgent)` albo
`navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1`; standalone to
`navigator.standalone === true` albo `matchMedia('(display-mode: standalone)').matches`.
`Notification.requestPermission()` wywołuj wyłącznie w obsłudze kliknięcia.

Subskrypcja: `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`,
gdzie klucz to `vapidPublicKey` zdekodowany z base64url do `Uint8Array`.

### Ten tydzień (`#/`)

- Nagłówek z zakresem dat, np. „9–15 listopada".
- Karta „Twoje zadanie": tytuł, opis, duży przycisk „Zrobione". Po odhaczeniu: „Zrobione ✓"
  i link „Cofnij". Wolne: „W tym tygodniu masz wolne". Brak tygodnia: „Brak grafiku na ten tydzień".
- Lista „W tym tygodniu": zadanie, osoba, stan. Stuknięcie cudzego zadania pyta
  „Odhaczyć za: Bartek?" i zapisuje z `by` równym bieżącej osobie. Gdy odhaczył ktoś inny
  niż przypisany, pokaż „odhaczone przez: …".
- „Za tydzień: {zadanie}".
- Banery: brak sieci („Brak połączenia — dane z {godzina}"), błąd arkusza („Nie udało się
  odczytać arkusza od {data}. Widzisz ostatnią poprawną wersję."), wyłączone powiadomienia
  („Powiadomienia są wyłączone" z przyciskiem „Włącz").

Odhaczanie jest optymistyczne: od razu zmień widok, przy błędzie cofnij i pokaż komunikat.

### Grafik (`#/grafik`)

Tabela: wiersze to tygodnie (`DD.MM–DD.MM`), kolumny to zadania (sam tytuł). Przyklejony
nagłówek, przewijanie w poziomie, bieżący tydzień wyróżniony i przewinięty do widoku,
minione tygodnie przygaszone, komórki bieżącej osoby wyróżnione. Pod spodem: „Odśwież
z arkusza" (`POST /api/refresh`), „Otwórz arkusz w Excelu" (`sheet.url`, `target="_blank"`,
`rel="noopener"`) i „Ostatnia synchronizacja: …".

### Ustawienia (`#/ustawienia`)

- Osoba, z możliwością zmiany (zmiana ponownie wysyła subskrypcję z nową osobą).
- Przypomnienia: lista reguł (dzień tygodnia + godzina co 15 minut), „Dodaj", usuwanie,
  „Przywróć domyślne". Zapis przez `PUT /api/prefs`.
- Powiadomienia: stan, „Wyślij testowe", „Wyłącz na tym urządzeniu" (`unsubscribe()` + `DELETE`).
- Informacja o wersji i ostatniej synchronizacji.

### Service worker — `public/sw.js`

- `install`: wstępnie zapisz powłokę; `skipWaiting()`. `activate`: `clients.claim()`.
- `fetch`: dla żądań `GET` z tej samej domeny poza `/api/` — odpowiedz z cache i w tle
  odśwież wpis (stale‑while‑revalidate). Żądań `/api/` nie dotykaj.
- `push`: `event.waitUntil(showNotification(title, { body, tag, renotify: true, icon, badge, data, actions: [{ action: 'done', title: 'Zrobione' }] }))`.
  Gdy treści nie da się odczytać, pokaż powiadomienie ogólne („Sprzątanie", „Sprawdź grafik").
- `notificationclick`: zamknij powiadomienie. Dla akcji `done`: odczytaj `/__config` z cache,
  wyślij `POST /api/done`; przy błędzie otwórz aplikację. W pozostałych przypadkach aktywuj
  otwarte okno aplikacji albo otwórz `/`.
- `pushsubscriptionchange`: zasubskrybuj ponownie i wyślij na serwer (na ile przeglądarka pozwala).

Przyciski akcji w powiadomieniu działają w Chrome; iOS je pomija, co nie jest błędem.

## 8. Kamienie milowe

### M1 — szkielet serwera i grafik

`wrangler` jako jedyna zależność deweloperska, `wrangler.jsonc`, `src/worker.js`, `app.js`,
`store.js`, `refresh.js`, `handlers.js` z `GET /api/state` i `POST /api/refresh`, autoryzacja,
`scripts/gen-flat-code.js`.

Akceptacja: testy pokazują `401` bez kodu i ze złym kodem; `/api/state` zwraca grafik z pliku
testowego; uszkodzony plik lub odpowiedź HTML nie nadpisuje poprzedniego grafiku i ustawia
`sheet.error`; drugie odświeżenie w ciągu 60 s nie pobiera arkusza. `npx wrangler dev`
startuje i odpowiada na `/api/state`.

### M2 — powłoka PWA

`index.html`, style, `app.js`, `api.js`, ekrany Ten tydzień i Grafik (tylko odczyt), ekran
powitalny (kod i osoba), service worker z cache powłoki, manifest, ikony, `_headers`.

Akceptacja: zrzut ekranu z przeglądarki w rozmiarze telefonu pokazuje poprawne dane dla
ustalonej daty; po wyłączeniu sieci strona otwiera się z ostatnim stanem; konsola nie zgłasza
naruszeń CSP; w źródłach nie ma `innerHTML` z danymi.

### M3 — push od końca do końca

`push.js`, krok powiadomień na ekranie powitalnym, `/api/subscriptions`, `/api/push-test`,
obsługa `push` i `notificationclick`, „Wyślij testowe" w Ustawieniach.

Akceptacja: testy walidacji subskrypcji i `push-test` (w tym `410`). **Testu na prawdziwym
telefonie nie da się zautomatyzować** — opisz właścicielowi dokładne kroki i poproś
o potwierdzenie na Androidzie i, jeśli jest dostępny, na iPhonie.

### M4 — przypomnienia

`core/reminders.js`, `tick.js`, `/api/prefs`, edycja reguł w Ustawieniach.

Akceptacja: wszystkie testy z §6.2 i §6.3. Lokalnie cron da się wywołać ręcznie
(`wrangler dev --test-scheduled`; adres wyzwalający sprawdź w dokumentacji).

### M5 — „Zrobione"

`/api/done`, przycisk i lista stanu, akcja „Zrobione" w powiadomieniu, pomijanie odhaczonych
w `tick.js`.

Akceptacja: testy walidacji (przyszły tydzień, wolne, nieznana osoba), cofanie, brak
przypomnienia po odhaczeniu.

### M6 — domknięcie

README z instrukcją wdrożenia (§9) i jednostronicową instrukcją dla współlokatorów (osobno
Android i iPhone), sprzątanie tabeli `sent`, przegląd dostępności, przegląd wszystkich
komunikatów błędów, pomiar czasu CPU po wdrożeniu.

## 9. Wdrożenie — kroki dla właściciela

Wykonawca nie ma dostępu do konta Cloudflare, więc te kroki robi człowiek. Każde polecenie osobno:

```bash
npx wrangler login
```

```bash
npx wrangler d1 create sprzatanie
```

Wklej zwrócone `database_id` do `wrangler.jsonc`.

```bash
npx wrangler d1 migrations apply sprzatanie --remote
```

```bash
node scripts/gen-vapid.js
```

Klucz publiczny wpisz do `vars.VAPID_PUBLIC_KEY`. Prywatny podaj jako sekret:

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

```bash
node scripts/gen-flat-code.js
```

```bash
npx wrangler secret put FLAT_CODE
```

```bash
npx wrangler secret put SHEET_URL
```

```bash
npx wrangler deploy
```

Adres z wyniku wpisz do `vars.VAPID_SUBJECT` i wdróż ponownie. Potem otwórz na telefonie
`https://<adres>/?k=<kod>` i przejdź ekran powitalny do testowego powiadomienia.

## 10. Pułapki

- `Intl` potrafi zwrócić godzinę `24:00` — dlatego `localParts` wymusza `hourCycle: 'h23'`. Nie zmieniaj tego.
- Strefa czasowa jest wyłącznie po stronie serwera i pochodzi z `TIMEZONE`. Nie używaj strefy przeglądarki do decyzji o tygodniu; korzystaj z `today` ze stanu.
- `controller.cron` trzeba porównywać z dokładnym napisem z konfiguracji.
- Apple odrzuca tokeny VAPID ważne dłużej niż 24 h oraz źle sformatowane `sub`. Obecne 12 h jest celowe.
- Na darmowym planie jedno wywołanie ma 10 ms CPU i 50 żądań wychodzących. Nie łącz parsowania arkusza z wysyłką powiadomień.
- Test `node --test` bez wzorca uruchomiłby też `test/helpers/` — dlatego skrypt używa `test/*.test.js`.
- `node:sqlite` wypisuje ostrzeżenie o funkcji eksperymentalnej. Jest niegroźne.
- Arkusz może zawierać komórki z błędem (`#VALUE!`) i obrazki w komórkach; parser je pomija. Nie „naprawiaj" tego.
- Nie zapisuj adresu arkusza ani kodu w logach.
