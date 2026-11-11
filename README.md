# Sprzątanie

PWA dla mieszkania: czyta grafik sprzątania z arkusza Excel i przypomina powiadomieniami push,
kto co ma w tym tygodniu do zrobienia. Działa na darmowym planie Cloudflare Workers.

**Stan:** projekt i plan są gotowe; zaimplementowane i przetestowane są moduły bazowe
(pobieranie i parsowanie arkusza, Web Push sprawdzony względem implementacji referencyjnej, czas lokalny). Aplikacja jeszcze nie istnieje.

- [docs/DESIGN.md](docs/DESIGN.md) — wymagania, decyzje projektowe i ich uzasadnienie
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — plan implementacji krok po kroku

## Testy

Wymaga Node 22.13 lub nowszego.

```bash
npm ci
```

```bash
npm test
```
