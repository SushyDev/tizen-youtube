# How this is put together

Five layers, and the directory listing is the map.

```
app/          config.xml · index.html · icon.png    what the .wgt is made of
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
> `service/` reaches `service/dev/` only through `service/dev/index.js`, which a ship build swaps for `none.js`.

Only `framework/` and `mods/` are held to this, by `no-restricted-imports` in `eslint.config.js`;
nothing lints the imports in `service/`. Without that rule `../mods/y.js` from inside the framework
resolves perfectly well, and the separation goes back to being a habit.

`framework/index.js` is the whole of the public surface. Everything else under `framework/` is
private, and a mod that imports it directly fails lint.

Only `mods/feed/surfaces.js` may name a feed container such as `sectionListRenderer`. Every other
mod registers with the walk instead, and `no-restricted-syntax` in `eslint.config.js` enforces it.

## What the framework is for

Each registry replaced something that had been written several times and leaked differently.

| Registry | What it replaced |
|---|---|
| `feed.js` — `onTile` / `keepTile` / `onShelf` / `keepShelf` / `onSurface` | Eight traversals of each shelf |
| `commands.js` — `onCommand` | Two files independently patching `resolveCommand`, racing to wrap each other |
| `keys.js` — `onKey` | Six capturing `document` key listeners serving two features, never removed |
| `player.js` — `whenPlayer` / `whenVideo` | Nine separate waits for the player, six of them `waitFor` polls, with three disagreeing selectors |
| `schedule.js` — `every` / `after` / `until` | A 500 ms interval that leaked, and an adoption window that stacked a new timer per navigation |
| `json.js` — `onResponse` / `onRequest` | One merged key set, so every handler ran for every response that matched any of them |
| `internals.js` — `findBySource` / `whenFound` | A full scan of a 3116-entry registry per call, and four hand-rolled retry loops |

## Boot

`mods/index.js` is the whole of it: imports register — some also start work there and then — and
`boot()` runs the phases.

```
network → settings → ui → intercept
```

`network` first because it takes over `fetch` and `XHR` before anything asks the network for
anything. `intercept` last because taking over `JSON.parse` seals registration — a handler
registered afterwards warns instead of silently never firing.

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
  **archive** root, and `service/lib/cobaltConfig.js` reads `../../config.xml` at runtime from
  `service/dist/`. `tools/paths.js` stages `app/`'s contents flat for that reason.
- The proxy port is written in three places: `tizen.config.json`, `service/lib/ports.js`, and the
  `--proxy` switch in `app/config.xml`. `npm run package` fails if `app/config.xml` disagrees with
  `tizen.config.json`, or if `service/lib/ports.js` does — a mismatch is a television that shows
  nothing and says nothing.
- `tools/check-output.js` rejects any built-in newer than Cobalt 3.2.1 / node 12. Babel lowers
  syntax; it does not polyfill a library call.
- The container is launched directly, so it can come up before the service listens. `--base_url`
  is therefore `file:///tube/boot.html`, a dmesg-style boot screen.
  The page is the ES modules in `service/boot/`, which rollup bundles beside the
  userscript. `service/lib/bootScreen.js` writes it into the `web/` folder of our `--content` copy
  after staging, and Cobalt serves it from there.
  - Before the service answers, it logs the Cobalt, Evergreen and Starboard versions and the wait.
  - Once the service answers, it polls `/__tube/boot`, which gives the Patch stamp Settings shows,
    Tizen, the model, node, the userscript, and every service log line since the last.
  - It moves on to `https://www.youtube.com/tv` only when three things hold: the certificate is
    ready, the TV can reach YouTube, and `https://www.youtube.com/__tube/ping` answers through
    Cobalt's proxy and our certificate, the same path the page will take. It carries its own query
    string, which holds Cobalt's device authentication.
  - If that answer fails three times, it asks the service, once, to start the container again.
    That is what a certificate issued during the container's life needs.
  - Otherwise it stays on the log and says in red what it waits on.
- A container's claim window counts from when the service starts listening, not from the wake.
- A dev build with `TUBE_START_DELAY=<ms>` holds the port shut, so the race can be reproduced.
- `/__tube/log` is the journal: one continuous log from the service's start on, rotated file
  included. It holds the service's notes, the boot screen's own lines (`screen:`), and the page's
  (`page:`). The framework's `report()` and `warn()` send those through `/__tube/journal`, along
  with page errors, rejections and the userscript's boot line. Each distinct line goes once, and
  at most 100 per page load.
  - The service's side is noted too: `console.error`/`console.warn` (`error:`/`warning:`), node's
    own warnings, and errors thrown in a route (`route:`).
  - How the previous run ended (`uncaught:`, `exit:`) is shown again at the top of the next run
    as `previous:`. So a crash that restarts the service stays on the boot screen, which also
    says when the service's pid changes.
- The 5.0+ widget (`tube-tizen-5.0.wgt`) differs in two ways. Its service (`TUBE_TARGET=legacy`) is
  ES5 with core-js for node 4.4.3, and `service/legacy/` stands in for the Buffer, `mkdirSync`, http2,
  TLS-socket and `normalize` behaviour old node lacks. And Cobalt 20 keeps its trust store read-only
  with no `--content`, so instead of intercepting TLS it loads the page from the service:
  `--base_url=http://127.0.0.2:8099/tv`, which a gold build allows over loopback. The userscript is
  the same one — Cobalt 20 runs V8 6.5.
- Served that way, every media request must reach `/cors-bypass/`, because googlevideo answers CORS
  only for `https://www.youtube.com`. Two traps stood in the way, and both failed silently.
  - Cobalt 20 cannot construct `URL` (`TypeError: URL is not constructible`). So
    `mods/network/originRewrite.js` reads hosts with a regex, and the userscript must never call
    `new URL`.
  - Below node 7, node-fetch falls back to whatwg-url, whose tr46 rejects googlevideo's `rr2---sn-`
    hosts, so `service/legacy/url.js` stands in for it.
  - Cobalt 20 also has no `Worker`, and its `fetch` is a JavaScript polyfill over XHR.
  - Below node 8, streams have no `destroy`. `proxy.js` unpipes and drains a media stream the page
    drops instead, because calling it crashed the service. The smoke test drops one.
- googlevideo refused the PO token the served page minted until the page presented itself as
  YouTube. `mods/network/pageOrigin.js` makes `location` and `document.URL` read
  `https://www.youtube.com`. Cobalt 20 leaves location forgeable; a browser does not, so there it does
  nothing. Navigation still maps back to the real origin, and `realOrigin()` still builds the
  bypass. With that, kabuki fetches its integrity token first-party
  (`/api/jnn/v1/GenerateIT`), and googlevideo answers `protection ok`.
- googlevideo opens every media answer with `STREAM_PROTECTION_STATUS`, which the player shows only
  as a timeout. `service/lib/protection.js` logs it as `media: itag N: protection
  ok/pending/required`, so a set's log shows whether attestation was accepted.
- kabuki counts only `www.youtube.com` and `accounts.google.com` as production hosts, and draws a
  red `NO DEBUG ACCESS DOMAIN=` watermark on any other. The host is the one thing the 5.0+ widget
  cannot change, so the service redirects `/tv` to carry `env_hideWatermark=true`, kabuki's own
  exemption for exactly that check. Nothing else in kabuki reads the host list; debug mode is keyed
  to fishfood builds, `web-release-qa` and `expflag`, none of which apply.
- Three files are excluded from `tsc`, and two of them from the style rules, because live sibling
  branches own them. They come back under both when those branches land.
