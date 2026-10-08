# Valen Quiz (A-DAY 2026 booth)

Static participant page served by GitHub Pages so the printed QR never depends on Google account routing.
The page shows the landing, info, quiz and saving screens, and saves through a JSON API (Apps Script, fetch only).

## Permanence rule

The QR is already printed and encodes https://kaizer1908-dev.github.io/valen-quiz/.
Do not rename or move this repository, change its Pages path `/valen-quiz/`, or rename the `kaizer1908-dev` account.
Pushing `main` publishes to that URL, so it happens only at the approved publish steps.

## Public repository

This repository is public. It holds no secrets, no Sheet IDs, no staff PIN and no real personal data.
The API address in `defaults.js` is public by nature and may stay there.

## Files

- `index.html`: screens and wiring (inline CSS and script, ES2017 only).
- `quiz-core.js`: pure logic (API client, validation, storage, routing). Loaded as `window.QuizCore`.
- `defaults.js`: build id, API address and the embedded fallback question and consent text. Loaded as `window.VALEN_QUIZ_DEFAULTS`.
- `test/`: `node --test` suites. No dependencies and no build step.

Both script tags in `index.html` carry the same `?v=<build>` as `defaults.js`. Change all three together when publishing.

## Tests

```powershell
node --test
```

## Local preview

```powershell
py -m http.server 8765 --directory "C:\CLAUDE\valen-quiz-web"
```

Then open `http://localhost:8765/?demo=1` in a 390x844 window. `?demo=1` runs without a server, shows the `미리보기`
badge and issues in-memory tickets that cannot be used. Without `demo`, the page calls the live API.
