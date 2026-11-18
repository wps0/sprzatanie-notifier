# Instrukcje dla agenta

Kontekst: `docs/DESIGN.md` (decyzje i ich uzasadnienie), potem `docs/IMPLEMENTATION_PLAN.md`
(pierwotny plan; tam, gdzie kod się od niego różni, rozstrzyga kod i `DESIGN.md`).

## Kod

- Nowy kod piszemy w TypeScript, zgodnie z
  [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html):
  tylko nazwane eksporty (wyjątek: domyślny eksport wymagany przez runtime Workers),
  bez `any` (w testach tylko z komentarzem), `readonly` tam, gdzie się da, JSDoc przy
  eksportach. Formatowanie: `npm run format` (Prettier w konfiguracji `gts`).
- TypeScript uruchamia się bez kroku budowania: Node usuwa typy, Wrangler bundluje Workera.
  Importy wskazują pliki z rozszerzeniem (`./store.ts`).
- Moduły `src/core/*.js` są zweryfikowane; zostaną przepisane na TypeScript w osobnym PR.
- Nazwy w kodzie, API i adresach po angielsku; po polsku tylko teksty dla użytkownika.

## Zasady, których nie wolno łamać

- Jak najmniej zależności, wszystkie w `devDependencies`, przypięte do dokładnej wersji.
  Kod w `src/` nie importuje paczek npm; nic z CDN. Nowa zależność wymaga zgody właściciela.
- Żadnych prawdziwych imion, adresu arkusza, kodu mieszkania ani kluczy w repozytorium.
- Dane z arkusza trafiają na stronę wyłącznie jako tekst (nigdy `innerHTML`).
- Każde zdarzenie `push` pokazuje powiadomienie. Telefon nie robi nic w tle.
- Opisy PR-ów po angielsku; mniejsze PR-y zamiast jednego dużego.

## Polecenia

```bash
npm ci
```

```bash
npm test && npm run typecheck
```

Muszą przechodzić przed każdym commitem. Wymagany Node ≥ 22.18.

Czego nie da się zrobić bez właściciela: wdrożenia na Cloudflare i testu powiadomień na
prawdziwym telefonie. Gdy do tego dojdziesz, zatrzymaj się i podaj mu dokładne kroki.
