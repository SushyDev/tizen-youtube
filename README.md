# YouTube for Tizen

Ad-free YouTube for Samsung TVs, as an app of its own.

<img src="icon.png" width="96" align="right">

A rewrite of TizenTube Standalone: no loading screen, a 68% smaller userscript,
and no CDN on the critical path. Both userscript bundles ship inside the
package, so a first launch works with no network at all — the origin is an
update path, not a dependency.

- Adverts and sponsor segments gone, on the TV's own YouTube client
- Runs as its own app; the stock YouTube app is left alone
- Tizen 3 and up — one bundle for modern sets, one for old ones
- Updates over the air, digest-verified, with the shipped copy as the floor

---

## Install

The widget is signed for the television it was built for — Tizen names the
device inside the distributor certificate and enforces it from Tizen 7 — so a
release downloaded from here installs nowhere but its builder's set.

**Use [Tizen Homebrew](https://github.com/SushyDev/tizen-homebrew).** It re-signs
every package for the TV it is running on, which is the whole reason it exists:
open it on the TV, pick this app out of the catalogue, done. That is the
supported path and the one that needs no computer.

Building it yourself needs **Node 20+** and a certificate pair minted for your
TV. Tizen Homebrew mints them into `~/.tizen-certs`, which is where this
repository looks:

```sh
git clone https://github.com/SushyDev/tizen-youtube.git
cd tizen-youtube
npm install
npm run package          # builds, signs, writes release/tube.wgt
```

Then install `release/tube.wgt` from Tizen Homebrew's **Upload** tab, or over
sdb if the TV still points at your machine.

---

## Commands

| | |
| --- | --- |
| `npm run doctor` | Check prerequisites when something looks wrong |
| `npm run build` | Boot screen, both userscript bundles, the service |
| `npm test` | Lint, rewrite parity, routing, loader, update flow |
| `npm run package` | Build and sign a `.wgt` (`-- --release` refuses a placeholder origin) |
| `npm run release` | Stage `release/origin/` — the bundles and `latest.json` |
| `npm run dev` | The boot screen in a browser, no hardware needed |
| `npm run dev:service` | The service off-TV, on `:8099` |
| `npm run version -- 1.2.0` | Set the version everywhere it is written |
| `npm run clean` | Remove every build artefact |

---

## How injection works

Two paths, chosen at launch by asking the service which is available.

**CDP injection — preferred, used when Developer Mode is on.** Over the TV's
own SDB daemon, `shell:0 debug <appId>` relaunches this app with the Chrome
DevTools Protocol enabled and prints the port it chose. Attaching to that lets
the userscript be evaluated straight into youtube.com with
`Page.setBypassCSP` — no proxying, no URL rewriting, no cookie surgery. The
visible "restart" at launch is the app relaunching itself under the debugger.

**Local proxy — fallback, used when Developer Mode is off.** All of
youtube.com is proxied through `localhost:8099` so a plain script tag can
inject the userscript. This path rewrites media and static hosts through a
CORS bypass and renames the `__Secure-` / `__Host-` cookie prefixes, because
the page is now served over plain HTTP where those prefixes are rejected.

`service/lib/proxy.js` carries that rewrite table **unchanged** from the
reference — it is empirically derived against YouTube's TV client and every
rule is load bearing. `service/test/rewrite-parity.js` is a differential test
that fails if our output ever diverges from the reference's for the same input.

## Why there is no loading screen

The reference rendered a title and an animated progress bar here. It existed
only to paper over the app relaunching itself under the debugger. `ui/` shows a
black frame instead and routes as soon as the service answers, which reads as
faster than an animation.

## Two bundles, one source

Legacy support in a browser bundle is not free the way it is in a Node
service — core-js, the fetch polyfill and ES5 downlevelling are parsed and
executed on *every* launch. So they ship only to the TVs that need them:

| Bundle | Target | Contents |
| --- | --- | --- |
| `modern` | Chrome 63+ / Tizen 5.5+ | no core-js, no fetch polyfill, no DOMRect polyfill, no ES5 downlevel |
| `legacy` | Chrome 47 / Tizen 3–4 | full polyfill set |

`service/lib/loader.js` picks the variant from the platform version.

### Measured against the reference

| Bundle | Raw | Gzip |
| --- | --- | --- |
| TizenTube (reference) | 556,988 | 151,556 |
| `modern` | 178,633 | 51,412 |
| `legacy` | 213,184 | 63,146 |

68% smaller on modern TVs — 369KB less to parse on every launch. Where it came
from:

- **~375KB** — the reference statically imported all 30 locales. Only English
  is bundled now; the rest are fetched once from the origin and cached.
- **~150KB** — `esprima` + `estraverse` were shipped so that four call sites
  could find a property name in minified YouTube source.
  `mods/utils/findAssignments.js` does the same job with a marker-anchored scan.
- **33KB** — a static language-name map, replaced by `Intl.DisplayNames` where
  the webview has it and an on-demand fetch where it does not.

`JSON.parse` is still patched globally, but now rejects anything that cannot be
a YouTube response with one set lookup over the object's own top-level keys
instead of ~19 deep optional-chaining probes — measured 2.5x faster on the
rejection path, which is the overwhelmingly common case.

`spatial-navigation-polyfill.js` (1756 lines) was audited for removal and
**kept in both bundles**. Chrome has never shipped spatial navigation
unflagged, so no Tizen webview provides it natively, and `mods/ui/ui.js`
calls the global `navigate()` and `window.__spatialNavigation__` directly to
drive remote-control focus. Dropping it would break D-pad navigation on every
TV, not just old ones.

## The CDN is never on the critical path

Both bundles ship **inside the .wgt**, so first launch works with no network at
all. On top of that:

1. On launch, `latest.json` is checked in the background.
2. A newer bundle is downloaded and its **SHA-256 verified against the
   manifest** before it is written anywhere.
3. Load order is verified-cache → bundled. The digest is re-checked on every
   read, so a file truncated by a power cut falls back rather than executing.

Every failure path keeps the last known good script. The reference fetched from
jsDelivr on every launch and, on failure, injected
`alert("Failed to request to JSDelivr CDN.")`.

### When a TV actually checks

The service is `background-support="enable"`, so it outlives the app and can
stay resident for days. Checking only at service start would mean a pushed
update lands only after a TV reboot. So the check is driven by
`/__tube/state`, which the shell hits exactly once per launch, debounced to
once per 15 minutes (`UPDATE_CHECK_INTERVAL` in `service/index.js`).

`/__tube/state` also reports the script the TV would run right now — version,
variant, and whether it came from the cache or the bundled copy — so "did my
update land?" is answerable without guessing.

### One version, one publish

Bundles are fetched **by path** but updates are detected **by digest**, and
versioned paths are cached immutable. Republishing a version with different
content therefore fails silently and permanently: every TV downloads the stale
edge copy, fails the digest check, and falls back forever. `npm run release`
reads the live `latest.json` and refuses this.

## Serving the origin

The origin is named once, in [`tizen.config.json`](tizen.config.json), and baked
into both the userscript and the service at build time — nothing on the TV
depends on an environment variable. `TUBE_ORIGIN` overrides it for CI and
one-off builds.

`npm run release` stages `release/origin/`. Upload its contents to the origin
root and put a CDN in front:

```
/<version>/*     Cache-Control: public, max-age=31536000, immutable
/latest.json     Cache-Control: public, max-age=60
```

Versioned paths are immutable, so they cache at the edge forever. Until an
origin is set the placeholder host stands, which is fine to develop and package
against — `npm run release` and `npm run package -- --release` are the two that
refuse it.

---

## Working on it

```sh
npm run dev          # the boot screen in a browser
npm run dev:service  # the proxy, rewrite table and loader, headless on :8099
npm test
```

Only DIAL discovery and debugger injection need real hardware, and those report
clearly instead of crashing. Point the dev server at a set with
`TUBE_TV=192.168.2.9 npm run dev`.

| Path | |
| --- | --- |
| `mods/core.js` | The userscript's entry: what is patched, and when |
| `mods/features/` | Adblock, SponsorBlock, quality, queueing, subtitles |
| `mods/ui/` | The settings panel drawn over YouTube's own |
| `service/index.js` | Routes, and the once-per-launch update check |
| `service/lib/injector.js` | CDP injection over loopback sdb |
| `service/lib/proxy.js` | The rewrite table, carried unchanged |
| `service/lib/loader.js` | Which bundle a TV gets, and from where |
| `ui/src/boot.js` | The boot screen, which exists to disappear |

Two platform floors are easy to trip and the build enforces both: the boot
screen against Chromium 63, which drops CSS it cannot parse *silently*, and the
service bundle against Node 4.4.3 — `service/build/check-node4.js` walks the
AST and fails the build on syntax Tizen 3 cannot parse. Transpiling only
first-party sources, which is what the reference does, leaves 111 such
constructs in the output.

### Ports

| Port | Purpose |
| --- | --- |
| 8099 | proxy + service endpoints (`/__tube/state`, `/__tube/inject`) |
| 8095 | DIAL server the phone's YouTube app discovers |
| 26101 | the TV's own SDB daemon |
| 8001 | the TV's Smart View REST API (developer-mode state) |

All four are named once in `service/lib/ports.js`. The reference hardcoded them
per use site and drifted: its injector navigated with
`additionalDataUrl=...localhost:8085...` while the standalone DIAL server binds
8095, so cast payloads were silently dropped on the CDP path.

### Route order is load bearing

The proxy's catch-all matches every path, so `proxy.attachFallback()` is called
**after** the service registers `/__tube/state` and `/__tube/inject`. Attaching
it first shadows them: the shell polls for state, receives YouTube's HTML
instead of JSON, and the app never launches. `service/test/routing.js` pins
this.

### Releasing

Publishing a GitHub release builds, signs and attaches the widget, and stages
the origin bundles as a run artefact. Set once under **Settings → Secrets and
variables → Actions**: `TIZEN_AUTHOR_P12`, `TIZEN_AUTHOR_PW`,
`TIZEN_DISTRIBUTOR_P12` as secrets (the p12s base64-encoded, plus
`TIZEN_DISTRIBUTOR_PW` if it differs), and `TUBE_ORIGIN` as a variable. Tag and
version have to agree — `npm run version -- 1.2.0` sets it everywhere.

Exactly one `.wgt` is attached per release, and that is load bearing: Tizen
Homebrew's catalogue takes the first package asset it finds.

---

Licensed GPL-3.0-only. Derived from
[TizenTube](https://github.com/reisxd/TizenTube) and
[youtube-webos](https://github.com/webosbrew/youtube-webos), and from the people
who worked out what a Samsung TV will and will not allow.
