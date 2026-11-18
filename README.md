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
