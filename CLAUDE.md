# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Morse Walker is a browser-based CW (Morse code) pileup trainer for amateur radio operators, inspired by VE3NEA's Morse Runner. It is a static front-end app (no backend) built with vanilla JavaScript ES modules, bundled by webpack, and styled with Bootstrap/Bootswatch. Deployed at morsewalker.com.

## Commands

- `npm start` — webpack dev server with hot reload, opens browser (uses `webpack.config.dev.js`).
- `npm run build` — production bundle into `dist/` (`webpack.config.prod.js`) **and** generates JSDoc API docs into `dist/docs`.
- `npm run format` — Prettier over `src/**/*.{js,css,html}`. This is the only "lint" step.

There is **no test runner** — `npm test` is a placeholder that exits 1. Validation of game/CW logic is done manually in the browser (see "Cheat mode" below). Several source files (`util.js`, `stationGenerator.js`) contain commented-out, hand-run test cases rather than an automated suite; if you change `compareStrings` or callsign generation, re-run those cases by uncommenting them in a scratch context.

### Formatting / commit hooks

- Husky runs `npm run format` on **pre-commit** (`.husky/pre-commit`), so commits auto-format the whole `src` tree.
- Prettier config (`.prettierrc`): `semi: true`, `singleQuote: true`, `tabWidth: 2`, `trailingComma: es5`. **This repo uses 2-space indentation enforced by Prettier** — follow it for files under `src/`, even though it differs from other global preferences.

## Architecture

The app is a single-page UI driven by `src/index.html` plus the ES modules under `src/js/`. `app.js` is the webpack entry point and the orchestrator; the other modules are stateless helpers it composes.

### Module responsibilities

- **`app.js`** — owns all mutable game state (module-level `let`s like `currentMode`, `currentStations`, `currentStation`, `readyForTU`, `totalContacts`). Wires up DOM event listeners on `DOMContentLoaded`, persists user station settings + selected mode to `localStorage`, and implements the four game actions: `cq()`, `send()`, `tu()`, `reset()`/`stop()`. **State lives here and nowhere else** — the helper modules never hold game state.
- **`modes.js`** — two config tables keyed by mode name (`single`, `contest`, `pota`, `sst`, `cwt`):
  - `modeUIConfig` — purely presentational (which info fields show, placeholders, results-table columns).
  - `modeLogicConfig` — the QSO "script" as functions (`cqMessage`, `yourExchange`, `theirExchange`, `yourSignoff`, `theirSignoff`) plus flags (`showTuStep`, `requiresInfoField`, `extraInfoFieldKey`). These functions take `(yourStation, theirStation, arbitrary)` and return the literal text to key as Morse. **To add or change a contest mode, edit these two tables** rather than adding branching logic in `app.js`. `showTuStep` is the key behavioral switch: true = multi-station pileup flow, false = single-caller flow.
- **`audio.js`** — the CW sound engine. `createMorsePlayer(station)` returns `{ playSentence, context }`; it builds an `OscillatorNode` + `GainNode` per station on the shared `audioContext`, maps text → Morse via `morseCodeMap` (incl. prosigns like `<bk>`/`<ar>`), and schedules dot/dash gain ramps with smooth attack/release to avoid clicks. Handles Farnsworth timing (`CHAR_UNIT` vs `FARNS_UNIT`) and QSB fading (`qsbAmplitude`). Also owns the **audio lock** (`updateAudioLock`/`getAudioLock`) and the looping background-static/QRN engine (a separate `AudioContext`).
- **`stationGenerator.js`** — pure random data generation. `getYourStation()` reads the user's settings from inputs; `getCallingStation()` fabricates a random opponent (weighted US vs. non-US prefixes, callsign format like `2x3`, name/state/serial/CWOps number, randomized WPM/volume/tone/QSB).
- **`inputs.js`** — the single source of truth for reading the form. `getInputs()` = `getDOMInputs()` + `validateInputs()`, returning the inputs object or `null` when validation fails (and visually marking invalid fields + opening the relevant accordion). **Any module needing settings calls `getInputs()`** — it is called liberally and re-reads the DOM each time.
- **`util.js`** — stateless helpers: `compareStrings()` (the fuzzy callsign matcher — returns `perfect`/`partial`/`none` via five documented criteria; this is the core "did the user copy the call correctly" logic), pileup helpers (`addStations`, `respondWithAllStations`, `normalizeStationGain`), and results-table DOM rendering.

### Two critical cross-cutting mechanisms

1. **Audio scheduling via timers, not callbacks.** Web Audio API events are scheduled ahead on `audioContext.currentTime`. `playSentence(text, startTime)` returns the time the audio *will finish*. The whole game flow threads these return values forward (`yourResponseTimer` → `theirResponseTimer` → …) to sequence CQ → response → exchange → sign-off. There are no `setTimeout`-based game steps; timing is expressed as future `AudioContext` timestamps.

2. **The audio lock** (`audioLockUntil` in `audio.js`). Every action checks `getAudioLock()` and returns early if audio is still playing, then calls `updateAudioLock(finishTime)` after scheduling. This prevents the user from triggering overlapping CW while a transmission is in flight. `stopAllAudio()` hard-resets by closing and recreating the `AudioContext`.

### Game flow summary

- **Single mode** (`showTuStep: false`): CQ → one station calls → user copies callsign → on perfect match, full exchange + sign-off auto-plays, contact is logged, next station auto-appears.
- **Contest/POTA/SST/CWT modes** (`showTuStep: true`): CQ spawns a *pileup* of stations (`addStations`, count via `weightedRandom`). User types a call into `responseField`; `send()` runs `compareStrings` against every active station. Perfect match → exchange plays and `readyForTU` is set; user then fills the info field(s) and presses TU, which `tu()` validates against the station's attributes, logs the QSO, removes the worked station, and may add a new caller. `?`/`AGN`/`QRS` are special inputs handled in `send()` (repeat / slow down via Farnsworth).

## Conventions

- All public functions carry JSDoc; `npm run build` turns these into the published API docs. Keep JSDoc current when changing signatures.
- "Cheat mode": station details (callsign, name, state, etc.) are logged to the browser JS console via `printStation()`/the `console.log` calls in `audio.js`. This is intentional — it's the documented way to debug and to peek at answers.
- Assets (audio, images, manifest) are copied into `dist/` by webpack `CopyPlugin`; `static.mp3` is the QRN noise source.
