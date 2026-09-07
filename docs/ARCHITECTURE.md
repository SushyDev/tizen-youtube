# How this is put together

Five layers, and the directory listing is the map.

```
app/          config.xml · index.html · icon.png · assets/    what the .wgt is made of
framework/    the patch framework — knows YouTube, never knows a feature
mods/         features only, grouped by what they act on
service/      the Node service that ships inside the widget
  service/dev/    aliased out of a release build entirely
tools/        every build, release and diagnostic script
  tools/dev/      the dev server's injected page code
test/         the userscript suites
```

## The rule

> `mods/` may import `framework/index.js`, and nothing deeper.
> `framework/` may import nothing above it.
> Nothing shipped may import `tools/`.
> `service/lib/` may not reach `service/dev/`.

This is enforced by `no-restricted-imports` in `eslint.config.js`, not by convention. Without
that rule `../mods/y.js` from inside the framework resolves perfectly well, and the separation
goes back to being a habit.

`framework/index.js` is the whole of the public surface. Everything else under `framework/` is
private, and a mod that imports it directly fails lint.

## What the framework is for

Each registry replaced something that had been written several times and leaked differently.

| Registry | What it replaced |
|---|---|
| `feed.js` — `onTile` / `keepTile` / `onShelf` / `keepShelf` | Nine entry points into a tile array, and eight traversals of each shelf |
| `commands.js` — `onCommand` | Two files independently patching `resolveCommand`, racing to wrap each other |
| `keys.js` — `onKey` | Six capturing `document` key listeners serving two features, never removed |
| `player.js` — `whenPlayer` / `whenVideo` | Nine `waitFor` polls with three disagreeing selectors |
| `schedule.js` — `every` / `after` / `until` | A 3000 ms interval that was never cleared, a 500 ms one that leaked, and an adoption window that stacked a new timer per navigation |
| `json.js` — `onResponse` / `onRequest` | One merged key set, so every handler ran for every response that matched any of them |
| `internals.js` — `find` / `whenFound` | A full scan of a 3116-entry registry per call, and four hand-rolled retry loops |

## Boot

`mods/index.js` is the whole of it: imports register, then `boot()` runs the phases.

```
network → paint → settings → feed → player → ui → intercept
```

`network` first because it takes over `fetch` and `XHR` before anything asks the network for
anything. `paint` second because the theme has to be up before the frame it would otherwise flash
through. `intercept` last because taking over `JSON.parse` seals registration — a handler
registered afterwards warns instead of silently never firing.

**`boot()` must stay synchronous.** `preferredQuality` seeds `localStorage` before kabuki's own
script reads it, which works only because our tag is parser-inserted and theirs is async.
Deferring to `DOMContentLoaded` would move the quality decision to after the first frame.

## Dev and ship

Two build-time gates, one per side.

- **Userscript**: `framework/flags.js` folds `DEV_TOOLS` to a literal `false`, terser drops the
  `if (DEV_TOOLS) { … }` block in `mods/dev/index.js`, and its `unused` pass drops the modules.
  The shape is load bearing — an array like `FEATURES.concat(DEV_TOOLS ? [...] : [])` folds the
  array and keeps the functions. Release is ~16KB smaller than `TUBE_DEV=1`.
- **Service**: `service/vite.config.mjs` resolves `./dev/index.js` to `./dev/none.js` unless
  `TUBE_DEV=1`. An alias rather than dead-code elimination, because the service is deliberately
  built unminified so it can be read on a television when something has gone wrong. A ship build
  contains no `/eval`, no `x-tube-token`, no `/__tube/dev/` and no `cors`.

## Things that will bite

- `app/` is a *source* directory. Tizen resolves `<content src>` and `<icon src>` relative to the
  **archive** root, and `service/lib/cobalt.js` reads `../../config.xml` at runtime from
  `service/dist/`. `tools/paths.js` stages `app/`'s contents flat for that reason.
- The proxy port is written in three places: `tizen.config.json`, `service/lib/ports.js`, and the
  `--proxy` switch in `app/config.xml`. `npm run package` fails if the last two disagree — a
  mismatch is a television that shows nothing and says nothing.
- `tools/check-output.js` rejects any built-in newer than Cobalt 3.2.1 / node 12. Babel lowers
  syntax; it does not polyfill a library call.
- Four files carry `@ts-nocheck` and are exempt from the style rules, because live sibling
  branches own them. They come back under both when those branches land.
