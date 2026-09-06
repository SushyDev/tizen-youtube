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
| `npm run dev:service` | The service off-TV, on `:8099` |
| `npm run version:set 1.2.0` | Set the version everywhere it is written |
| `npm run clean` | Remove every build artefact |

### Inside Samsung's Cobalt container

Three metadata keys in `config.xml` hand the widget to `com.samsung.tv.cobalt`, and
`native.userdata` reaches it as command line switches. That is worth having because Cobalt is the
only stack on these sets that plays 2160p60 VP9 HDR properly. `npm run package` produces it by
default, and **every value in that metadata is the same on every television** — one widget, shared
as it is, installed with `sdb` and nothing else.

Getting there meant three things stop being per-set:

**The address.** The container is a different package from the service, and this platform refuses
loopback across packages — `127.0.0.1` answers `EHOSTUNREACH` and `::1` answers `EACCES`, measured
both ways round. A LAN address would work but cannot follow DHCP and cannot be known when the
package is built. So the switch names the set instead of numbering it: Cobalt resolves the
television's own hostname, which is `Samsung`, and the router hands back whatever address it
leased. When a set answers to some other name, or the name resolves to a different machine, the
service writes `cobalt: unreachable` or `cobalt: misdirected` to `service.log` — the failure on
screen is otherwise an unexplained "network error".

**The content directory.** `--content` is the loader's *alternative content directory* and the name
reads one level too high: it replaces the Evergreen content directory outright, so it must name the
directory that itself holds `fonts/`, `icu/`, `licenses/` and `ssl/certs/`
(`starboard/loader_app/loader_app.cc` substitutes it for `<content>/app/cobalt/content`, and
`slot_management.cc` for `<installation>/content`). Point it at the tree above and the container
still starts — the library path is resolved separately and this switch does not touch it — but with
no certificates and no ICU data, which looks like a network fault. The service stages that copy
itself from `/usr/apps/com.samsung.tv.cobalt/content/app/cobalt/content`, which the app user can
read; about 5.1MB, once, and it needs no `manifest.json` and no `lib/`.

**The certificate.** To inject anything the service has to serve the page, and to keep
`www.youtube.com` as the origin it has to terminate TLS. That needs a certificate authority the
container trusts, and `service/lib/x509.js` issues one **on the television**. That is not a
convenience: a single authority baked into a release would ship its private key to everyone who
downloaded it, and anyone holding it could impersonate Google to every set running this. The key
never leaves the set it was made on, and it is trusted by nothing but the staged copy — the
platform stores are untouched.

Two details that fail silently if they are wrong, both pinned by `service/test/x509.js`: the leaf
must live inside Chromium's **398-day** limit, because Cobalt has no notion of a locally added root
that would be exempt; and `ssl/certs/` is an OpenSSL hashed directory, so the file must be named
`<subject_hash>.0` — SHA-1 over the *canonical* name encoding, which has no outer `SEQUENCE` — with
a second copy under `-subject_hash_old` to cover both lookups.

From cold this takes about six seconds:

```
cobalt: staged: 136 files into /home/owner/share/tube/cobalt-content
cobalt: issued: Tube Local CA (Samsung)
cobalt: trusted: Tube Local CA (Samsung) as 942e0bcf.0 and 007d6692.0
mitm: accepted www.youtube.com
```

Until the material exists every host is tunnelled through untouched, so the first launch shows
stock YouTube rather than an error. `touch /home/owner/share/tube/mitm/disabled` keeps it that way.
`TUBE_COBALT_BASE_URL`, `TUBE_COBALT_PROXY` and `TUBE_COBALT_CONTENT` override the three switches at
package time, for experiments.

---

## How it works

**Injection.** Two paths, chosen at launch by asking the service which is
available. With Developer Mode on, `shell:0 debug <appId>` over the TV's own sdb
daemon relaunches this app under the Chrome DevTools Protocol, and the
userscript is evaluated straight into youtube.com with `Page.setBypassCSP` — no
proxying, no rewriting. With it off, youtube.com is proxied through
`localhost:8099` so a plain script tag can inject instead; that path rewrites
media and static hosts and renames the `__Secure-` / `__Host-` cookie prefixes,
because the page is now plain HTTP. `service/lib/proxy.js` carries that rewrite
table **unchanged** from the reference — it is empirically derived, every rule
is load bearing, and `service/test/rewrite-parity.js` fails if our output ever
diverges.

**Two bundles.** Polyfills in a browser bundle are parsed on *every* launch, so
they ship only to the TVs that need them. `modern` (Chrome 63+ / Tizen 5.5+)
drops core-js, the fetch polyfill and the ES5 downlevel; `legacy` (Chrome 47 /
Tizen 3–4) keeps them. `service/lib/loader.js` picks from the platform version.
Against the reference's 556,988 bytes: `modern` is 178,633, `legacy` 213,184 —
369KB less to parse on modern sets. Most of it was 30 statically imported
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
npm run dev:service  # the proxy, rewrite table and loader, headless on :8099
npm test
```

`npm run dev` runs the real service beside Vite, and the boot screen hands over
to it exactly as it would on a television — so what opens is youtube.com's own
TV client, through the real proxy, with the real userscript in it. Every
feature is reachable, video included. Editing anything under `mods/` rebuilds
the bundle in about half a second; reload the page and it is running.

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
| `service/index.js` | Routes, and the once-per-launch update check |
| `service/lib/injector.js` | CDP injection over loopback sdb |
| `service/lib/proxy.js` | The rewrite table, carried unchanged |
| `service/lib/loader.js` | Which bundle a TV gets, and from where |
| `service/lib/ports.js` | 8099 proxy, 8095 DIAL, 26101 sdb, 8001 Smart View |
| `ui/src/boot.js` | The boot screen, which exists to disappear |
| `ui/dev/tube.js` | `npm run dev`: the real service and the userscript watcher, beside Vite |

Two platform floors are easy to trip and the build enforces both: the boot
screen against Chromium 63, which drops CSS it cannot parse *silently*, and the
service bundle against Node 4.4.3 — `service/build/check-node4.js` walks the AST
and fails on syntax Tizen 3 cannot parse. Route order is load bearing too:
`proxy.attachFallback()` runs **after** the service registers its endpoints, or
the catch-all shadows them and the app never launches. `service/test/routing.js`
pins it.

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
