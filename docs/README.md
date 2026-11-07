# YouTube for Tizen

Ad-free YouTube on a Samsung TV.

<img src="../app/icon.png" width="96" align="right">

- Adverts and sponsor segments gone, on the TV's own YouTube client
- Own homescreen app
- Using native Cobalt Container for perfect playback performance
- Tizen 5.0 and up

**Discord**: https://discord.gg/WjxVnrsV4A

---

## Why this one

Recent Samsung TVs carry Cobalt, the engine YouTube built for televisions: it is what the
stock YouTube app runs in, tuned by Samsung and YouTube for each model. This app runs inside that
same engine, not the TV's web browser. So what you watch is the stock app's own playback, with the
4K, HDR and smooth 60fps your set was made for, and none of the adverts.

The mods are built the same way. Wherever they can, they change what YouTube is told rather than
painting over it, and leave the drawing to YouTube itself. The start page opens the way a YouTube
link would, scroll speed is YouTube's own animation run faster, quality is set per video through
the player's own controls, and every setting is a real row in YouTube's own Settings.

| | This app | [TizenTube](https://github.com/reisxd/TizenTube) |
| --- | --- | --- |
| Runs on | Samsung TVs, Tizen 5.0+ | Samsung TVs, Tizen 3+ (Or 6.5+ Cobalt) |
| Engine | Samsung's own Cobalt, same as stock YouTube | The TV's browser or early buggy development copy of Cobalt engine from this project |
| Updates | Through Tizen Homebrew; the mods ship inside the app. | Mods pulled from a public CDN at launch, unchecked; if it's unreachable, the ads are back |
| Settings | Rows in YouTube's own Settings | A separate pop-up menu, behind one Settings entry or the green button |
| Ad blocking | ✓ | ✓ |
| SponsorBlock bar | Perfectly integrated in the native player UI | A fixed-width strip, misaligned on chaptered videos, popping in and out |
| DeArrow | Titles and thumbnails swapped in as the feed arrives | Broken |
| Preferred quality | Set before each video streams; nearest at or below your pick. | Switched after the video starts, so the picture jumps or re-buffers; previews forced up too |
| Start page | Opens first, and after an account switch | Home loads, then it jumps; with none set, Home reloads every launch |
| Who's watching | Hidden, and answered for you if it shows anyway | Only pushes its timer back; no fallback when it shows |
| Scroll speed | Up to 3× | Stuck at stock speed |
| Rapid press | Presses kept | Presses dropped while the feed moves |
| Smoother navigation | ✓ | ✗ |
| Hide the Up next card | ✓ | ✗ |
| Hide the shopping card | ✓ | ✗ |
| Dislike button | ✓ | ✗ |

---

## Install

### Tizen Homebrew

The easy one. No computer needed after setup, even for updates.

1. Set up [Tizen Homebrew](https://github.com/SushyDev/tizen-homebrew) once, by its README.
2. Open it on the TV.
3. Pick this app out of the catalogue.

### Apps2Samsung, with a partner certificate

Apps2Samsung also works, signed with your own Samsung partner certificate.
Please join the Discord linked above if you need help.

### Building it yourself

For the Homebrew route, if you would rather not use the catalogue, with **Node 20+**:

```sh
git clone https://github.com/SushyDev/tizen-youtube.git
cd tizen-youtube
npm install
npm run package    # release/tube-tizen-5.5.wgt and tube-tizen-5.0.wgt, for Tizen Homebrew
```

Load the one for your TV — `tube-tizen-5.5.wgt` from Tizen 5.5, `tube-tizen-5.0.wgt` from 5.0 — through
Homebrew's **Upload** tab; [DEVELOP.md](DEVELOP.md) has the other commands.

---

Licensed GPL-3.0-only. Derived from
[TizenTube](https://github.com/reisxd/TizenTube) and
[youtube-webos](https://github.com/webosbrew/youtube-webos), and from the people
who worked out what a Samsung TV will and will not allow.

Sponsor segments, retitled clickbait and dislike counts come from
[SponsorBlock](https://github.com/ajayyy/SponsorBlock),
[DeArrow](https://github.com/ajayyy/DeArrow) and
[Return YouTube Dislike](https://github.com/Anarios/return-youtube-dislike).

The Cobalt container route was first published here on 2026-09-06, in
[#16](https://github.com/SushyDev/tizen-youtube/pull/16),
[#26](https://github.com/SushyDev/tizen-youtube/pull/26) and
[#27](https://github.com/SushyDev/tizen-youtube/pull/27). TizenTube's own Cobalt build followed on
2026-09-11; [REISXD.md](REISXD.md) compares the two.

---

## Experimental Tizen 5.0 Service Startup Workaround

This branch-only experiment is **not part of the official upstream release**. The owner
confirmed it on a **Samsung The Frame 2019 (QE55LS03RAUXZG), Tizen 5.0, Node.js 4.4.3**.
On that TV, the original package did not reliably start `TubeService` at boot or app
launch, although starting the service explicitly worked. The legacy lifecycle exports
were corrected, but that alone did not fix automatic startup. The precise firmware,
registration, permission, or timing cause remains unproven.

The web-based **Tube Starter** starts its own service through `tizen.application.launch()`
when needed and waits for **HTTP 204** from `http://127.0.0.2:8099/__tube/ping`, with a
bounded timeout. It then opens **Tube Cobalt**, a separate Handoff package that preserves
the existing Samsung metadata and arguments to launch the TV's native YouTube player.
The original direct Cobalt pairing skips the web entry page, so the two entries currently
need different package IDs. **Both WGTs are required for the complete startup flow.**

### Build and test

Use the host Node.js version in `.nvmrc` (currently 24) and npm; the TV's Node.js 4.4.3
is only the legacy service runtime. From the repository root on `fix/tizen5-service-start`:

```sh
npm ci
npm run build
npm test
npm run package
npm run package:start-poc
```

`build` builds the userscript and modern/legacy services. `package` also rebuilds and
creates the regular legacy WGT required as input by `package:start-poc`. `npm test`
runs lint, type checking, userscript, service, and Starter tests; local simulations
are not TV tests. The two required **unsigned** outputs are:

| Output | Package ID | Purpose |
| --- | --- | --- |
| `release/tube-tizen-5.0-start-poc.wgt` | `tUb3Xq7L50` | Web Starter and its own `TubeService`; original project icon. |
| `release/tube-tizen-5.0-cobalt-handoff-poc.wgt` | `tUb3Xq7LCb` | Native Cobalt Handoff; separate test icon and no service. |

### Sign and install both packages

For this manual installation route, use Tizen Studio's CLI/SDB tools and the Samsung
Certificate Extension. Configure a **Samsung Partner** signing profile with the target
TV's DUID: the Starter's `http://tizen.org/privilege/appmanager.kill` requires partner
privilege. See [Samsung's certificate setup](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html).
Enable TV Developer Mode for the installation computer and permit installation through
the SDK's Device Manager. A generic public/emulator certificate is insufficient.

Make separate copies of **both** unsigned outputs outside the checkout, then sign each
copy using your configured profile. Replace these placeholders; never put certificate
files, passwords, private keys, or signed packages into Git. The
[Samsung CLI reference](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/sdk-tools/baseline-sdk/common-tools/command-line-interface.md)
supports re-signing an existing package:

```sh
tizen package -t wgt -s PARTNER_PROFILE -- "<STARTER_WGT_COPY>"
tizen package -t wgt -s PARTNER_PROFILE -- "<HANDOFF_WGT_COPY>"
```

Use the signed paths reported by the CLI below. The owner confirmed the **Starter push
and `vd_appinstall` pair** on the target TV; the Handoff commands apply the same procedure
with its own app ID. Windows example, from the SDK directory containing `sdb.exe`
(use `sdb` from your PATH on other systems):

```powershell
.\sdb.exe connect "<TV_IP>:26101"
.\sdb.exe push "<SIGNED_STARTER_WGT>" "/home/owner/share/tmp/sdk_tools/tube-start-signed.wgt"
.\sdb.exe shell 0 vd_appinstall tUb3Xq7L50.Tube /home/owner/share/tmp/sdk_tools/tube-start-signed.wgt
.\sdb.exe push "<SIGNED_HANDOFF_WGT>" "/home/owner/share/tmp/sdk_tools/tube-cobalt-signed.wgt"
.\sdb.exe shell 0 vd_appinstall tUb3Xq7LCb.TubeCobalt /home/owner/share/tmp/sdk_tools/tube-cobalt-signed.wgt
```

Require a successful installer result for **each** package. The Starter app ID is
`tUb3Xq7L50.Tube`; its service ID remains `tUb3Xq7L50.TubeService`. Installing it replaces
the existing Tizen 5.0 Tube package, so retain your previous package and use the same
author certificate for updates. The Handoff has its own identity and does not replace
the Starter or Samsung's original YouTube app. Do not uninstall or modify Samsung's app.

### Daily use and limitations

After installing both packages, open **Tube Starter** deliberately; no computer is
needed at runtime. Disable the TV's **Autorun Last App** setting to prevent the TV
from reopening the Starter/player on power-on. The workaround itself disables prelaunch
and service boot startup; it cannot reliably distinguish a visible TV-driven restore
from a deliberate opening.

- **Service already ready:** reuse it, do not proactively terminate Cobalt, and attempt
  the normal Handoff.
- **Service explicitly started:** after its accepted launch and confirmed HTTP 204,
  revalidate and terminate exactly one matching `com.samsung.tv.cobalt-yt` context, if
  present and unambiguous; verify its disappearance before the Handoff. A failed ping
  alone never authorizes a kill. Ambiguous or changed targets are not automatically killed.
- **Bounds:** at most **one targeted kill and two Handoff attempts per user launch**.
  A second Handoff is allowed only after an existing context disappears and is checked
  again. A blocked normal Handoff can offer explicitly confirmed manual cleanup, sharing
  the same kill budget. Kill errors or a remaining target context stop that cleanup path.
- **Known limitation:** if original YouTube is already active while the service is ready,
  the Handoff may reuse its Cobalt context. The tested workaround is to hold **Back**
  until YouTube exits completely, then reopen Tube Starter. A context or accepted launch
  alone does not prove that the modified session is running.

A reliable **single-WGT architecture has not been demonstrated**. Other Samsung models
and Tizen versions still need validation. Detailed findings, test scope, and open questions:
[Technical report](UPSTREAM-REPORT.md), [daily use and TV test plan](DAILY-START-TIZEN5.md),
and [single-package investigation](ONE-PACKAGE-TIZEN5.md).
