# YouTube for Tizen

Ad-free YouTube on a Samsung TV, as an app of its own.

<img src="icon.png" width="96" align="right">

A rewrite of TizenTube Standalone. The userscript ships inside the package, so a
first launch works with no network at all — the origin is an update path, not a
dependency. No loading screen, and an 85% smaller script.

- Adverts and sponsor segments gone, on the TV's own YouTube client
- Its own app; the stock YouTube app is left alone
- Tizen 5.5 and up — one bundle, no polyfills
- Updates over the air, digest-verified, with the shipped copy as the floor

**Discord**: https://discord.gg/WjxVnrsV4A

---

## Install

**Use [Tizen Homebrew](https://github.com/SushyDev/tizen-homebrew).** Set it up
once by its README, then open it on the TV and pick this app out of the
catalogue. No computer after that.

That is not a convenience. A Tizen signature names the television it may be
installed on, and sets enforce it from Tizen 7 — a widget signed by whoever
built it installs on their set and nowhere else. Tizen Homebrew re-signs
whatever it installs with the pair the TV itself holds, which is what makes a
package written by somebody else installable at all.

So the widget on each [release](../../releases) is signed by
nobody, and Homebrew's **GitHub** or **Upload** tab takes it as it is. A
television refuses it over sdb, which is the expected half of the same fact.

Building it yourself needs **Node 20+**:

```sh
git clone https://github.com/SushyDev/tizen-youtube.git
cd tizen-youtube
npm install
npm run package    # release/tube.wgt, for Tizen Homebrew
```

---

## Commands

| | |
| --- | --- |
| `npm run doctor` | Check prerequisites when something looks wrong |
| `npm run build` | Boot screen, the userscript bundle, the service |
| `npm test` | Lint, waitFor, injection, routing, proxying, loader, update flow |
| `npm run package` | Build a `.wgt` — signed by nobody, which is what a release carries |
| `npm run release` | Stage `release/origin/` — the bundle and `latest.json` |
| `npm run dev` | The whole app in a browser, no hardware needed |
| `npm run dev:boot` | Just the boot screen, held on screen so it can be looked at |
| `npm run dev:service` | The service off-TV, on `:8099` |
| `npm run version:set 1.2.0` | Set the version everywhere it is written |
| `npm run clean` | Remove every build artefact |

---

## How it works

**Injection.** Two paths, chosen at launch by asking the service which is
available. With Developer Mode on, `shell:0 debug <appId>` over the TV's own sdb
daemon relaunches this app under the Chrome DevTools Protocol, and the
userscript is evaluated straight into youtube.com with `Page.setBypassCSP` — no
proxying, no rewriting. With it off, youtube.com is proxied through
`localhost:8099` so a plain script tag can inject instead. The page is then
plain HTTP, so the `__Secure-` / `__Host-` cookie prefixes are renamed, and
requests to the Google hosts that will not answer that origin go through the
service's `/cors-bypass/` route. Used as a forward proxy instead, the service
tunnels CONNECT and, once key material exists, terminates TLS for YouTube's and
Google's hosts itself, so the page keeps its real origin: cookies pass untouched
and YouTube's CSP stays, with the injected tags carrying its nonce.

**One bundle.** Polyfills in a browser bundle are parsed on *every* launch, and
the sets that needed them are gone: the floor is Chrome 63, so the ES5 downlevel,
core-js and the fetch polyfill go. Against the reference's 556,988 bytes
the bundle is 83,072 — 474KB less to parse. Most of it was 30 statically
imported locales (~375KB, now fetched on demand), `esprima` + `estraverse`
shipped for four call sites (~150KB, replaced by a marker-anchored scan), and a
static language-name map (33KB, now `Intl.DisplayNames`).

**Inside Samsung's Cobalt container.** The set ships a second YouTube runtime —
Cobalt, in `com.samsung.tv.cobalt` — and it is the stack that plays 2160p60 VP9
HDR properly, which the webview does not. A package can claim its slot through
three metadata keys: `pkgid` names the container, `nativeID` names the slot, and
`native.userdata` carries the switches it is started with. The slot carries
`read.metadata.from.hybrid.webapp`, so it takes those switches from the webapp
it is paired to, and `nativeID` cannot be dropped to keep our own content
running as well — a package carrying it never runs its own content at all, which
is why `auto-restart` and `on-boot` are what start the service.

`--proxy` names `127.0.0.2`, which is a fixed way of writing "this television"
on every television: one package cannot reach another's `127.0.0.1` on this
platform (`EHOSTUNREACH`), while any other loopback address connects, so there
is no DNS and nothing per-set. `--content` names a writable copy of Cobalt's own
content directory, staged on first run — about 5.1MB, nearly all of it
`icu/icudt68l.dat` — because the certificate authority has to go inside it and
the stock one is read-only.

Not every Tizen device has the container; a Smart Monitor is not a television.
On one that does not, the metadata hands the launch to something absent and
nothing ever starts. `TUBE_COBALT_CONTAINER=off npm run package` drops the three
keys and the app is the ordinary Chromium one again, boot screen and all.

**The CDN is never on the critical path.** The bundle is inside the `.wgt`.
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
npm run dev:service  # the proxy and loader, headless on :8099
npm test
```

`npm run dev` runs the real service beside Vite, and the boot screen hands over
to it exactly as it would on a television — so what opens is youtube.com's own
TV client, through the real proxy, with the real userscript in it. Every
feature is reachable, video included. Editing anything under `mods/` rebuilds
the bundle in about half a second; reload the page and it is running.

Two things are arranged for that to work off hardware, both of them
environment variables that nothing in a build sets:

| | |
| --- | --- |
| `TUBE_DEV_UA` | youtube.com/tv serves a redirect notice to anything that is not a television, so the proxy presents itself as one — upstream, and to the page |
| `TUBE_DEV_INJECT` | `ui/dev/remote.js`, injected after the userscript. A remote's colour and transport buttons are keyCodes no keyboard produces — this puts them on one. `b` is the blue button and opens the speed control, `Escape` is Return, and `tubeRemote(code)` presses anything else |

Point the dev server's `/__tube` routes at a set with
`TUBE_TV=192.168.2.9 npm run dev`.

`npm run dev:boot` is the other half: the boot screen exists to disappear, so
looking at it needs a stand-in that answers and never hands over. That is
`ui/dev/service.js`, and each state `boot.js` can meet is a query string —
`?boot=debugger`, `?boot=failed`, `?boot=slow`, `?boot=script`.

| Path | |
| --- | --- |
| `mods/core.js` | The userscript's entry: what is patched, and when |
| `mods/features/` | Adblock, SponsorBlock, quality, queueing, subtitles |
| `mods/ui/` | The settings panel drawn over YouTube's own |
| `service/index.js` | Routes, and the once-per-launch update check |
| `service/lib/injector.js` | CDP injection over loopback sdb |
| `service/lib/proxy.js` | Script injection, cookie renaming, and `/cors-bypass/` |
| `service/lib/forward.js` | Forward-proxy requests and the CONNECT tunnel |
| `service/lib/mitm.js` | TLS termination for YouTube's and Google's hosts |
| `service/lib/bigheaders.js` | The HTTP/2 refetch for headers too big for HTTP/1 |
| `service/lib/x509.js` | The certificate issuer |
| `service/lib/loader.js` | Which bundle a TV runs, and from where |
| `service/lib/ports.js` | 8099 proxy, 8097 dev |
| `ui/src/boot.js` | The boot screen, which exists to disappear |
| `ui/dev/tube.js` | `npm run dev`: the real service and the userscript watcher, beside Vite |

Two device pairs are verified on hardware —
Tizen 6.5 / node 12.16.3 / Cobalt 3.2.1, and Tizen 9.0 / node 18.18.2 /
Cobalt 5.2.1 — and everything between them is unverified, so the lower pair is
the floor. `tools/check-output.js` reads every built bundle and refuses a
*library* call newer than that: Babel and esbuild lower syntax to their target
and do it well, but neither polyfills `[].flatMap`, which compiles to itself and
throws on an engine that has never heard of it. A parser cannot see that,
because it is a method name and not a keyword — which is how `Object.values`
came to ship into a Chromium 47 bundle unnoticed.

A syntax gate cannot see a module that does not resolve either:
`require('fs/promises')` passes every check on a modern runner and kills the
service on its first require on the set. So `service/test/smoke.js` loads the
built bundle for real and asks it a question, on the two verified runtimes and
the versions around them — in CI as the `runtimes` job, and locally as `npm run test:matrix`.
`tools/engine-probe.js` measures what Cobalt actually supports, for raising the
floor on evidence rather than on hope.

The boot screen has its own floor, Chromium 63, which drops CSS it cannot parse
*silently*. Route order is load bearing too: `proxy.attachFallback()` runs
**after** the service registers its endpoints, or the catch-all shadows them and
the app never launches. `service/test/routing.js` pins it.

**Releasing.** Pushing a `v*` tag builds the widget and opens a
**draft** release carrying it — no secrets at all, on purpose, so it works on a
fresh clone. Write the notes and press Publish. It has to be a draft, and the
tag has to be what starts it: GitHub freezes a release once it is published and
refuses assets from then on, and it fires no workflow event when a draft is
saved, so this has to be the thing that opens the draft rather than something
that joins one made by hand. Exactly one `.wgt` per release, which matters:
Homebrew's catalogue takes the first package asset it finds. Tag and version
have to agree — `npm run version:set 1.2.0` sets it everywhere at once, the
lockfile included. Set `TUBE_ORIGIN` as a repository **variable** to stage the
origin bundle too; without it the release still builds, and the app simply
never updates itself between releases.

---

Licensed GPL-3.0-only. Derived from
[TizenTube](https://github.com/reisxd/TizenTube) and
[youtube-webos](https://github.com/webosbrew/youtube-webos), and from the people
who worked out what a Samsung TV will and will not allow.
