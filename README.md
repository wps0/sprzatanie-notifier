# Sprzątanie

PWA dla mieszkania: czyta grafik sprzątania z arkusza Excel i przypomina powiadomieniami push,
kto co ma w tym tygodniu do zrobienia. Działa na darmowym planie Cloudflare Workers.

- [docs/DESIGN.md](docs/DESIGN.md) — wymagania i decyzje projektowe
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — pierwotny plan, kontrakt API, kroki wdrożenia

## Uruchomienie lokalne

Wymaga Node 22.18 lub nowszego.

```bash
npm ci
```

```bash
npm run build && npm run dev
```

Potem otwórz <http://localhost:8787/?code=dev>. Serwer podglądu używa prawdziwych handlerów API,
bazy w pamięci i testowego arkusza ze zmyślonymi imionami; powiadomienia tylko loguje.
Zmienna `DEV_NOW=2026-11-11T12:00:00Z` ustala datę.

## Testy

```bash
npm test && npm run typecheck
```

## Wdrożenie

Kroki są w [docs/IMPLEMENTATION_PLAN.md §9](docs/IMPLEMENTATION_PLAN.md); `npm run deploy`
buduje aplikację i wdraża ją razem z Workerem.

### Aplikacja na GitHub Pages (opcjonalnie)

Worker sam serwuje aplikację, więc Pages nie są potrzebne. Gdyby jednak strona miała stać
na GitHub Pages, a API zostać na Cloudflare:

1. W ustawieniach repozytorium: **Pages → Source: GitHub Actions**. Pages z prywatnego
   repozytorium wymagają płatnego planu GitHuba.
2. **Settings → Environments → github-pages → Deployment branches and tags**: ogranicz
   do `main`. To jest właściwe zabezpieczenie — sam plik workflow może zostać zmieniony
   na dowolnej gałęzi.
3. **Settings → Secrets and variables → Actions → Variables → Repository variables**:
   dodaj `API_BASE_URL` z adresem Workera, np. `https://sprzatanie.<konto>.workers.dev`
   (zmienna repozytorium, nie sekret i nie zmienna środowiska).
4. W `wrangler.jsonc` ustaw `ALLOWED_ORIGINS` na `https://<użytkownik>.github.io`
   i wdróż Workera ponownie.
5. Każdy push do `main` uruchamia `.github/workflows/deploy.yml`: typy, formatowanie,
   testy, budowanie i publikacja. Ręczne uruchomienie z innej gałęzi tylko buduje i testuje.

Kod mieszkania nie trafia na Pages — strona jest publiczna, ale bez kodu API nic nie zwraca.
