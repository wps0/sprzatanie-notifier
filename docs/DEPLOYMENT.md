# Wdrożenie

Cała aplikacja — API i strona — działa na jednym Cloudflare Workerze (darmowy plan).
Po jednorazowej konfiguracji wdraża ją GitHub Actions
([`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml)) przy każdym merge'u
pull requesta do `main`, i tylko wtedy.

Workflow w kolejności:

1. Sprawdza typy, formatowanie i testy.
2. Buduje aplikację.
3. Przed wdrożeniem sprawdza, że konfiguracja i sekrety Workera są na miejscu.
4. Wykonuje migracje bazy D1.
5. Wdraża Workera.

## Jednorazowa konfiguracja

Kroki 1–4 wykonujesz raz, na swoim komputerze, w katalogu repozytorium (`npm ci` najpierw).

### 1. Konto i baza

Załóż darmowe konto na <https://dash.cloudflare.com/sign-up>, a potem:

```bash
npx wrangler login
```

```bash
npx wrangler d1 create sprzatanie
```

Wypisane `database_id` wpisz do `wrangler.jsonc` w miejsce zer. Nie jest tajne.

### 2. Klucze powiadomień i adres

```bash
npm run gen:vapid
```

- `VAPID_PUBLIC_KEY` wpisz do `vars` w `wrangler.jsonc` (jest publiczny).
- `VAPID_PRIVATE_KEY` zachowaj na krok 3 — **nie** wpisuj go do żadnego pliku.
- `VAPID_SUBJECT` ustaw na adres aplikacji: `https://sprzatanie.<twoja-subdomena>.workers.dev`.
  Subdomenę widać w panelu Cloudflare, w sekcji **Workers & Pages**.

Zmiany w `wrangler.jsonc` wypuść zwykłym pull requestem — wdrożą się po merge'u.

### 3. Sekrety Workera

Sekrety żyją w Cloudflare, nie w GitHubie, i przetrwają kolejne wdrożenia. Najpierw
wygeneruj kod mieszkania:

```bash
npm run gen:code
```

Potem zapisz trzy sekrety. Każde polecenie pyta o wartość.

```bash
npx wrangler secret put FLAT_CODE
```

```bash
npx wrangler secret put SHEET_URL
```

```bash
npx wrangler secret put VAPID_PRIVATE_KEY
```

Wartości:

- `FLAT_CODE` — kod z `npm run gen:code`;
- `SHEET_URL` — link udostępniania arkusza;
- `VAPID_PRIVATE_KEY` — z kroku 2.

Przy pierwszym poleceniu Wrangler zapyta, czy utworzyć Workera `sprzatanie` — potwierdź.

### 4. Token dla GitHuba

W panelu Cloudflare: **My Profile → API Tokens → Create Token**.

1. Wybierz szablon **Edit Cloudflare Workers**.
2. Dopisz uprawnienie **Account → D1 → Edit**.
3. W **Account Resources** ogranicz token do swojego konta.

Zapisz token. Zanotuj też **Account ID**: jest w panelu, na stronie **Workers & Pages**
i na stronie konta.

### 5. GitHub

W repozytorium, **Settings**:

1. **Environments → New environment** o nazwie `cloudflare`, a w nim:
   - **Deployment branches and tags → Selected branches and tags → `main`**.
     To jest właściwe zabezpieczenie: tylko kod z `main` dostaje token.
   - **Environment secrets → `CLOUDFLARE_API_TOKEN`**: token z kroku 4.
   - **Environment variables → `CLOUDFLARE_ACCOUNT_ID`**: Account ID z kroku 4.
2. **Rules → Rulesets → New branch ruleset** dla `main`: włącz **Require a pull request
   before merging**. Dzięki temu każdy push do `main` to merge, a wdrożenie rusza
   tylko po merge'u.

### 6. Pierwsze wdrożenie

Zmerguj pull request (np. ten z uzupełnionym `wrangler.jsonc`). W zakładce **Actions**
pojawi się przebieg „Deploy the Worker to Cloudflare”. Po nim aplikacja jest pod adresem:

```text
https://sprzatanie.<twoja-subdomena>.workers.dev/?code=<FLAT_CODE>
```

Ten link (np. jako kod QR) wysyłasz współlokatorom.

## Gdy wdrożenie się nie uda

Komunikat błędu w Actions mówi, czego brakuje:

| Komunikat | Co zrobić |
|---|---|
| *No Cloudflare credentials* | Krok 5: sekret i zmienna w środowisku `cloudflare`. |
| *Placeholder database_id* / *Empty VAPID_…* | Kroki 1–2: uzupełnij `wrangler.jsonc` i zmerguj. |
| *Missing Worker secrets* | Krok 3. |
| Błąd uprawnień z Wranglera | Krok 4: token potrzebuje uprawnień do Workers i do D1 na tym koncie. |
