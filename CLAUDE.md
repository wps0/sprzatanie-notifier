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
  Aplikację webową (`src/web`, `src/sw`) kompiluje `npm run build` do `dist/`.
  Importy wskazują pliki z rozszerzeniem (`./store.ts`).
- Animacje: DOM jest przebudowywany przy każdej zmianie modelu, więc zwykła animacja CSS
  restartowałaby się. Zmiany ekranu i stanu zadań animuje View Transitions API
  (`src/web/main.ts`); drobne animacje idą przez `trigger()`/`animate()` z `src/web/motion.ts`.
  Wszystko z prefiksem `motion-safe:` — przy „ogranicz ruch” nic się nie rusza.
- Wygląd: klasy Tailwind CSS bezpośrednio w widokach. Każdą zmianę UI obejrzyj na zrzucie
  ekranu 390×844 w motywie jasnym i ciemnym (`npm run build && npm run dev`).
- Cały kod, testy i skrypty są w TypeScript; plików `.js` w repozytorium nie ma.
- `src/core/webpush.ts` składa prymitywy WebCrypto według RFC 8291/8292; każdą zmianę
  sprawdzają testy z przykładem z RFC i porównaniem bajt w bajt z `http_ece`.
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

Muszą przechodzić przed każdym commitem. Wymagany Node 26 (`.nvmrc`; CI czyta wersję z tego pliku).

Czego nie da się zrobić bez właściciela: wdrożenia na Cloudflare i testu powiadomień na
prawdziwym telefonie. Gdy do tego dojdziesz, zatrzymaj się i podaj mu dokładne kroki.
