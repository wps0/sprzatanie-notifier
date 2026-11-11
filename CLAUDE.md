# Instrukcje dla agenta

Przed jakąkolwiek zmianą przeczytaj `docs/DESIGN.md`, a potem `docs/IMPLEMENTATION_PLAN.md`.
Plan dzieli pracę na kamienie milowe M1–M6 — realizuj je po kolei, jeden na raz.

Zasady, których nie wolno łamać (pełna lista: `docs/IMPLEMENTATION_PLAN.md` §0):

- Zero zależności w `src/` i `public/`. Jedyna zależność deweloperska to `wrangler`.
- Nie przepisuj istniejących modułów w `src/core/` — są zweryfikowane.
- Żadnych prawdziwych imion, adresu arkusza, kodu mieszkania ani kluczy w repozytorium.
- Dane z arkusza trafiają na stronę wyłącznie przez `textContent`.
- Każde zdarzenie `push` pokazuje powiadomienie. Telefon nie robi nic w tle.

Testy: `npm test` (Node ≥ 22.13). Muszą przechodzić przed każdym commitem.

Czego nie da się zrobić bez właściciela: wdrożenia na Cloudflare i testu powiadomień na
prawdziwym telefonie. Gdy do tego dojdziesz, zatrzymaj się i podaj mu dokładne kroki.
