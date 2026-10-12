# Valen Quiz (A-DAY 2026 booth)

Static participant page served by GitHub Pages so the printed QR never depends on Google account routing.
The page walks one person through: the info form (name, email, phone with automatic hyphens, company and title, one required
consent), the event intro screen (`이벤트 안내`, shown once, with a start button), the concern choice, the one-question quiz,
a short wait (`잠시만요`) while the save is confirmed, and the final "participation complete" screen. The quiz answer stays on
the device: the save sends only the concern choice. The final screen is static (pill, gift, thanks, "show this screen to the
staff", logo on the team's blue gradient, `assets/gift.webp` and `assets/valen-logo.webp`): there is no ticket number, live
clock, status check or staff panel, and a reload after completion shows the same screen and makes no ticket request.
Sending the same phone number again ends on the same screen. The page saves through a JSON API (Apps Script, fetch only).
The theme is light.

## At the booth

Staff look at the participant's completion screen and guide the person to the roulette. There is no PIN and nothing is marked
as used. If the quiz feels hard, staff may tell the answer.

## Quiz content rules (Sheet)

- Use at most 9 quiz questions: the concern step is sent as the tenth answer (the server accepts 10 answers per submit).
- Never name a Sheet question `concern`: that id is reserved for the concern step.
- With more than 9 questions, or a question named `concern`, the page does not use the Sheet questions at all and falls back to the embedded question in `defaults.js` (the other Sheet gates still apply).
- The consent text version is `a-day-2026-v3` (in `defaults.js` and in the Sheet `consent_version`; the Sheet `consent_required_detail` carries the same four lines as `defaults.js`). Stored progress for another version (for example one consented under v2), or without all four required fields, goes back to the info form with the entered values kept.
- The quiz answer is never sent, whatever the content source. The submit body's `answers` are exactly the concern choice; the server needs at least one answer and the concern step always provides it.
- A stored state whose stage is `intro` (info given, start button not yet pressed) returns to the intro screen after a reload. Pressing the start button stores `introDone`, and progress stored by older builds (stage quiz or saving, a concern pick, a pending request or a ticket) is recognised as past the intro on load, so the intro is never shown again, not even after a trip back to the info form. A reload at the intro with outdated info (other consent version, a required field missing) returns to the info form. The `시작하기` button keeps the shared button style (white text on navy) like the other screens; all other intro text is #091550.

## Permanence rule

The QR is already printed and encodes https://kaizer1908-dev.github.io/valen-quiz/.
Do not rename or move this repository, change its Pages path `/valen-quiz/`, or rename the `kaizer1908-dev` account.
Pushing `main` publishes to that URL, so it happens only at the approved publish steps.

## Public repository

This repository is public. It holds no secrets, no Sheet IDs, no staff PIN and no real personal data.
The API address in `defaults.js` is public by nature and may stay there.

## Files

- `index.html`: screens and wiring (inline CSS and script, ES2017 only).
- `quiz-core.js`: pure logic (API client for config and submit, phone formatting, validation, storage, routing). Loaded as `window.QuizCore`.
- `defaults.js`: build id, API address and the embedded fallback question and the team's consent text. Loaded as `window.VALEN_QUIZ_DEFAULTS`.
- `assets/`: the gift (720x720) and logo (400x120) images of the final screen, transparent WebP.
- `test/`: `node --test` suites (`page.test.js` runs the real page scripts against a small fake DOM). No dependencies and no build step.

Both script tags in `index.html` carry the same `?v=<build>` as `defaults.js`. Change all three together when publishing.

## Tests

```powershell
node --test
```

## Local preview

```powershell
py -m http.server 8765 --directory "C:\CLAUDE\valen-quiz-web"
```

Then open `http://localhost:8765/?demo=1` in a 390x844 window. `?demo=1` makes no call to the quiz API (no config or submit request) and uses separate `demo:` storage keys; it shows the `미리보기` badge and
confirms the save in memory.
The optional Pretendard font still loads from jsdelivr in both modes and the page renders fully with the system font when it is blocked.
Without `demo`, the page calls the live API.
