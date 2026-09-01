# YouTube for Tizen

Ad-free YouTube on a Samsung TV, as an app of its own.

<img src="icon.png" width="96" align="right">

A rewrite of TizenTube Standalone. Both userscript bundles ship inside the
package, so a first launch works with no network at all — the origin is an
update path, not a dependency. No loading screen, and a 68% smaller script on
modern sets.

- Adverts and sponsor segments gone, on the TV's own YouTube client
- Its own app; the stock YouTube app is left alone
- Tizen 3 and up — one bundle for modern sets, one for old ones
- Updates over the air, digest-verified, with the shipped copy as the floor
- **Developer Mode must be on.** It is the only way in — see below

**Discord**: https://discord.gg/WjxVnrsV4A

---

## Install

**Use [Tizen Homebrew](https://github.com/SushyDev/tizen-homebrew).** Set it up
once by its README, then open it on the TV and pick this app out of the
catalogue. No computer after that.

**Developer Mode has to stay on.** This app injects over the television's own
sdb daemon, and that is the only route it has — with Developer Mode off it will
open, tell you so, and stop. Setting Tizen Homebrew up turns it on already
(Apps → 12345 → Developer mode On, Host IP `127.0.0.1`, restart the set), so in
practice this costs nothing; it is worth knowing because a factory reset or
some firmware updates turn it back off, and that is what it looks like when
they do.

That is not a convenience. A Tizen signature names the television it may be
installed on, and sets enforce it from Tizen 7 — a widget signed by whoever
built it installs on their set and nowhere else. Tizen Homebrew re-signs
whatever it installs with the pair the TV itself holds, which is what makes a
package written by somebody else installable at all.

So the widget on each [release](../../releases) is **unsigned**, and Homebrew's
**GitHub** or **Upload** tab takes it as it is. A television refuses it over
sdb, which is the expected half of the same fact.

Building it yourself needs **Node 20+**:

```sh
git clone https://github.com/SushyDev/tizen-youtube.git
cd tizen-youtube
npm install
npm run package -- --unsigned    # release/tube.wgt, for Tizen Homebrew
```

Drop `--unsigned` to sign it for your own TV and `sdb install` it. That needs a
certificate pair minted for the set; Tizen Homebrew mints them into
`~/.tizen-certs`, which is where this repository looks.

---

## Commands

| | |
| --- | --- |
| `npm run doctor` | Check prerequisites when something looks wrong |
| `npm run build` | Boot screen, both userscript bundles, the service |
| `npm test` | Lint, rewrite parity, routing, loader, update flow |
| `npm run package` | Build and sign a `.wgt` for your own television |
| `npm run package -- --unsigned` | The same package, signed by nobody — what a release carries |
| `npm run release` | Stage `release/origin/` — the bundles and `latest.json` |
| `npm run dev` | The whole app in a browser, no hardware needed |
| `npm run dev:boot` | Just the boot screen, held on screen so it can be looked at |
| `npm run dev:service` | The service off-TV, on `:8099`, with the development proxy |
| `npm run version:set 1.2.0` | Set the version everywhere it is written |
| `npm run clean` | Remove every build artefact |

---

## How it works

**Injection.** One path. `shell:0 debug <appId>` over the TV's own sdb daemon
relaunches this app under the Chrome DevTools Protocol, and the userscript is
evaluated straight into youtube.com with `Page.setBypassCSP`. No proxying and no
rewriting: the page is the real HTTPS origin, with its own cookies, talking to
Google directly.

There used to be a second path — a MITM proxy on `localhost:8099` for sets with
Developer Mode off, splicing in a script tag over plain HTTP. It is gone from
the device. Every byte of video went through a Node process on the TV's own SoC,
competing with the decoder for a CPU that has none to spare, and the rewriting
it had to do to make that work — media and static hosts, `__Secure-` / `__Host-`
cookie prefixes, the mixed-content scheme flip — was a standing source of
connection failures. Trading it for a hard Developer Mode requirement costs
nothing in practice, because installing this app needs Developer Mode anyway.

It survives as a **development harness only**, in `service/dev/`. `service/index.js`
— the entry ncc bundles — cannot reach it, so what ships cannot contain it
whatever a runtime flag says; `service/test/routing.js` pins both that and the
route ordering it depends on off-TV.

**A failure is a failure.** With nowhere to fall through to, the boot screen
reports what went wrong and holds the log on screen — the service hands it the
actual error — rather than dropping you into a YouTube with none of the
modifications in it and no way to tell why.

**Two bundles.** Polyfills in a browser bundle are parsed on *every* launch, so
they ship only to the TVs that need them. `modern` (Chrome 63+ / Tizen 5.5+)
drops core-js, the fetch polyfill and the ES5 downlevel; `legacy` (Chrome 47 /
Tizen 3–4) keeps them. `service/lib/loader.js` picks from the platform version.
Against the reference's 556,988 bytes: `modern` is 76,732, `legacy` 106,315 —
469KB less to parse on modern sets. Most of it was 30 statically imported
locales (~375KB, now fetched on demand), `esprima` + `estraverse` shipped for
four call sites (~150KB, replaced by a marker-anchored scan), and a static
language-name map (33KB, now `Intl.DisplayNames`). The spatial-navigation
polyfill is **kept in both** — no Tizen webview ships it, and dropping it would
break D-pad focus everywhere.

**The CDN is never on the critical path.** Both bundles are inside the `.wgt`.
On launch `latest.json` is checked in the background; a newer bundle is
SHA-256-verified against the manifest before it is written anywhere; load order
is verified-cache → bundled, with the digest re-checked on every read. Every
failure path keeps the last known good script. The check is driven by
`/__tube/state` — hit once per launch, debounced to 15 minutes — because the
service is `background-support="enable"` and can outlive the app for days.
`/__tube/state` also reports the script the TV would run right now, so "did my
update land?" is answerable without guessing.

**One version, one publish.** Bundles are fetched by path but updates are
detected by digest, and versioned paths cache immutable. Republishing a version
with different content therefore fails silently and permanently — every TV takes
the stale edge copy, fails the digest, and falls back forever. `npm run release`
reads the live `latest.json` and refuses this.

**The origin** is named once, in [`tizen.config.json`](tizen.config.json), and
baked into the userscript and service at build time — nothing on the TV reads an
environment variable. `npm run release` stages `release/origin/`; upload it to
the origin root with `/<version>/*` immutable and `/latest.json` at
`max-age=60`. Until an origin is set the placeholder host stands, which is fine
to develop and package against.

---

## Working on it

```sh
npm run dev          # the whole app in a browser
npm run dev:boot     # just the boot screen, held on screen
npm run dev:service  # the service and loader, headless on :8099
npm test
```

`npm run dev` runs the real service beside Vite and the boot screen hands over
to it, so what opens is youtube.com's own TV client with the real userscript in
it. Every feature is reachable, video included. Editing anything under `mods/`
rebuilds the bundle in about half a second; reload the page and it is running.

Off a television there is no sdb daemon and so no debugger, which is the whole
reason `service/dev/proxy.js` still exists: serving youtube.com from localhost
and splicing a script tag in is the only way to get the userscript into the page
in a desktop browser. `npm run dev` therefore starts `service/dev/index.js`,
not `service/index.js`, and the proxy URL is named in `ui/dev/tube.js` — the one
place a hand-over to anything other than the debugger can come from. The rewrite
table it uses is carried **unchanged** from the reference: it is empirically
derived, every rule is load bearing, and `service/test/rewrite-parity.js` fails
if our output ever diverges from it.

Three things are arranged for that to work off hardware, all of them
environment variables that nothing in a build sets:

| | |
| --- | --- |
| `TUBE_DEV_UA` | youtube.com/tv serves a redirect notice to anything that is not a television, so the proxy presents itself as one — upstream, and to the page |
| `TUBE_PLATFORM_VERSION` | With no platform to ask, every browser would look like a Tizen 3 and get the legacy bundle. Defaults to `6.5`; set it to `4.0` to work on the legacy one |
| `TUBE_DEV_INJECT` | `ui/dev/remote.js`, injected after the userscript. A remote's colour and transport buttons are keyCodes no keyboard produces — this puts them on one. `b` is the blue button and opens the speed control, `Escape` is Return, and `tubeRemote(code)` presses anything else |

Only DIAL discovery and debugger injection need real hardware, and those report
clearly instead of crashing. Point the dev server at a set with
`TUBE_TV=192.168.2.9 npm run dev`.

`npm run dev:boot` is the other half: the boot screen exists to disappear, so
looking at it needs a stand-in that answers and never hands over. That is
`ui/dev/service.js`, and each state `boot.js` can meet is a query string —
`?boot=debugger`, `?boot=failed`, `?boot=slow`, `?boot=script`.

The service binds `:8099` either way, so `npm test` and `npm run dev` cannot
run at the same time; the test suite says so rather than failing obscurely.

| Path | |
| --- | --- |
| `mods/core.js` | The userscript's entry: what is patched, and when |
| `mods/features/` | Adblock, SponsorBlock, quality, queueing, subtitles |
| `mods/ui/` | The settings panel drawn over YouTube's own |
| `service/index.js` | What ships: four lines, and no way to reach `dev/` |
| `service/lib/service.js` | Routes, and the once-per-launch update check |
| `service/lib/injector.js` | CDP injection over loopback sdb — the only route in |
| `service/lib/loader.js` | Which bundle a TV gets, and from where |
| `service/lib/ports.js` | 8099 service, 8095 DIAL, 26101 sdb, 8001 Smart View |
| `service/dev/proxy.js` | Development only: the rewrite table, carried unchanged |
| `ui/src/boot.js` | The boot screen, which exists to disappear |
| `ui/dev/tube.js` | `npm run dev`: the real service and the userscript watcher, beside Vite |

Two platform floors are easy to trip and the build enforces both: the boot
screen against Chromium 63, which drops CSS it cannot parse *silently*, and the
service bundle against Node 4.4.3 — `service/build/check-node4.js` walks the AST
and fails on syntax Tizen 3 cannot parse. Route order is load bearing in the
development entry too: `attachDev()` runs **after** the service registers its
endpoints, or the proxy's catch-all shadows them and the app never launches.
`service/test/routing.js` pins it.

**Measure before optimising.** `node tools/profile.js` profiles the three phases
separately, because the userscript costs something different in each: `startup`
(injection to steady state), `navigation` (a screen change through the JSON hooks and
the DOM rebuild under it) and `playback` (steady state at 60fps). Each compares the same
work with and without the script, so the number is ours rather than the page's.

One thing it cannot do is decode: a television decodes 4K60 in fixed-function hardware
off the main thread, headless Chromium has no such decoder, and a captureStream-backed
video element crashes the renderer here. The playback profile therefore simulates the
player element and measures what JavaScript can actually affect — main-thread occupancy
against the 16.7ms frame budget. `--churn` sets how many nodes a frame rewrites, which
is what the cost of anything observing the document scales with.

`node tools/bench.js` is the regression check rather than the microscope: it loads a real
Chromium and reports the two costs the userscript actually imposes: what the JSON hooks
add to a browse response against the native parse of the same bytes, and what anything
watching the document adds to node churn against the same churn without the script. It
needs `npm i --no-save playwright-core` and a Chromium; neither is a dependency of this
repo because neither is needed to build or ship it. `--profile` says where the JSON time
goes, and `--bundle <path>` points it at another build, which is the useful mode: build
one, keep it, build the other, run both. Desktop numbers are not television numbers, but
the ratio carries. It also fails the run if a decorated response has become circular or
if a decoration stopped applying, both of which are easy to reintroduce.

**The userscript runs on the main thread the decoder shares.** A MutationObserver
with `subtree: true` over `document.body` costs a MutationRecord allocation for
every node YouTube's renderer touches, whether or not the callback does anything
with it, and that is dropped frames rather than a slow function. Anything
watching the DOM should be connected only while it is needed and disconnected the
moment it is not, and a callback should cost one pass per batch rather than one
per record. The same goes for `getBoundingClientRect` in an event handler that
fires during playback. Where a change can be made through the JSON layer instead
— `mods/youtube/json.js`, which edits YouTube's own data before YouTube renders
it — that is both cheaper and less likely to break on a redesign.

**Releasing.** Pushing a `v*` tag builds the unsigned widget and opens a
**draft** release carrying it — no secrets at all, on purpose, so it works on a
fresh clone. Write the notes and press Publish. It has to be a draft, and the
tag has to be what starts it: GitHub freezes a release once it is published and
refuses assets from then on, and it fires no workflow event when a draft is
saved, so this has to be the thing that opens the draft rather than something
that joins one made by hand. Exactly one `.wgt` per release, which matters:
Homebrew's catalogue takes the first package asset it finds. Tag and version
have to agree — `npm run version:set 1.2.0` sets it everywhere at once, the
lockfile included. Set `TUBE_ORIGIN` as a repository **variable** to stage the
origin bundles too; without it the release still builds, and the app simply
never updates itself between releases.

---

Licensed GPL-3.0-only. Derived from
[TizenTube](https://github.com/reisxd/TizenTube) and
[youtube-webos](https://github.com/webosbrew/youtube-webos), and from the people
who worked out what a Samsung TV will and will not allow.
