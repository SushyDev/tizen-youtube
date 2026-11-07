# Development report: Tizen 5.0 service startup and Cobalt handoff

As of November 7, 2026. Prepared for local review before possible publication.
No GitHub issue or pull request has been created, and nothing has been pushed.
The working startup logic was not changed during this publication preparation.

## Comparison baseline and saved working state

- Original upstream release: local tag `v1.5.1`, commit
  `02c4d8b4bacfa6f0f0efb518fbb588d6fcd60e0e`.
- Working two-package state before the icon change: commit
  `6b99653aeaeec23723c22183c841a4961eb9ddde` on `fix/tizen5-service-start`.
- Additional local backup tag:
  `local/tizen5-working-before-original-icon-20261107`.
- Source and WGT checksums: [TIZEN5-WORKING-SNAPSHOT.json](TIZEN5-WORKING-SNAPSHOT.json).
  Copies of the previous unsigned WGTs are also preserved in
  `release/archive/verified-before-original-icon-2026-11-07/`.
- Because no Git identity was configured, the backup commit used
  `Local Tizen workaround snapshot <local-snapshot@localhost>` through command-local
  settings only. No global Git configuration was changed. This is a technical
  identity for a local backup, not a decision about publication authorship.

Reproducible source comparison:

```sh
git diff v1.5.1 -- package.json service/legacy/index.js service/test/legacy.js tools/test.js
git diff v1.5.1 -- tools/package-start-poc.js tools/poc tools/test-start-poc.js docs
git diff local/tizen5-working-before-original-icon-20261107 --
```

The first comparison covers changes to existing upstream files; the second also
includes the added PoC files. The final comparison shows only the current icon/test
adjustment and documentation relative to the saved workaround.
New drafts that are still untracked must additionally be listed with
`git ls-files --others --exclude-standard`.

## A. Initial situation

Test device, as reported by the user:

| Property | Value |
| --- | --- |
| Television | Samsung The Frame QE55LS03RAUXZG, 2019 model |
| Platform | Tizen 5.0 |
| Service runtime on the TV | Node.js 4.4.3 |
| Tube app | `tUb3Xq7L50.Tube` |
| TubeService | `tUb3Xq7L50.TubeService` |
| Service port | TCP 8099 |
| Signing of the installed test version | Samsung partner certificate |

With the original v1.5.1 package, TubeService did not start automatically after a
complete TV restart or when opening the application. YouTube displayed a network
error. Running `sdb shell 0 execute tUb3Xq7L50.TubeService` successfully started the
service; `/diag` then became reachable, all 5/5 diagnostic checks passed, and YouTube
worked, including ad blocking. These are TV test results reported by the user.

The regular package directly starts Samsung's native Cobalt engine. Its three
metadata entries are in [app/config.xml, lines 18–20](../app/config.xml#L18).
Upstream's HTML page is already just a notice explaining this native startup path
([app/index.html, lines 8–9](../app/index.html#L8)); it contains no service launch.
Native pairing bypasses the web entry page where an explicit service start could
otherwise run before launching the engine.

Tizen 5.0 packaging with a separate package prefix and loopback base URL was
**already part of v1.5.1**: [tools/package.js, lines 14–24](../tools/package.js#L14),
with `setRequiredVersion()`, `setPackageId()`, and `servePage()` starting at lines
147, 157, and 169. These functions and the regular target definitions were not reworked.

## B. Confirmed causes, observations, and unresolved hypotheses

**Confirmed in the source:** The legacy entry previously called only
`require('../index.js')`. The main module's exported lifecycle functions were not
forwarded to the legacy entry's `module.exports`. The correction is one line:
[service/legacy/index.js:7](../service/legacy/index.js#L7).
The main functions `onStart`, `onRequest`, and `onStop` already existed in
[service/index.js:165](../service/index.js#L165). The new regression test verifies
them on the built CommonJS legacy bundle, rather than inspecting source alone.

**Not a sufficient explanation for the entire boot problem:** After the export
correction, the user still reported missing automatic service startup. The export
issue is therefore a concrete legacy bug, but has not been established as the sole
cause of Samsung's lifecycle behavior. The original manifest's
`auto-restart="true"` and `on-boot="true"` did not produce the intended result on
the test device.

**Confirmed by reported TV tests:** A web starter in the same package can explicitly
start TubeService; the subsequent ping returns HTTP 204. A separate starter failed
because of the cross-package service access restriction. An existing Cobalt context
can prevent native startup; targeted termination followed by the handoff worked.
The user has since explicitly confirmed that the current startup logic works on
this device.

**Not established:** The precise reason why the firmware does not handle the
declarative service startup flags as expected. A general certificate problem,
broken service registration, a particular initialization timing issue, or fundamental
Node 4.4.3 incompatibility have not been demonstrated. Successful explicit startup
argues against registration or the runtime being completely unusable; it does not
prove that every boot and permission path works. No firmware timing profile was
measured. In particular, one failed ping does not prove that a new service process
has been created.

**Native integration:** The handoff preserves the project's Samsung pairing through
`pkgid`, `nativeID`, and `native.userdata`. The
[upstream account of Cobalt pairing](https://github.com/SushyDev/tizen-youtube/pull/26)
describes `read.metadata.from.hybrid.webapp` and missing arguments without pairing.
This is project experience, not a complete public Samsung specification for the
2019 firmware. A simple direct API launch of the system app has therefore not been
established as an equivalent replacement with reliable argument transfer.

Two WGTs are currently used so that an actual web page can first start its own
service, after which a separate native entry uses the tested pairing mechanism.
The Cobalt engine itself is supplied by the TV and is not bundled.

## C. Actual changes relative to v1.5.1

### Existing upstream files

| File and location | Actual change |
| --- | --- |
| [service/legacy/index.js:7](../service/legacy/index.js#L7) | Forward the main module's lifecycle exports: `module.exports = require('../index.js')`. |
| [service/test/legacy.js:46](../service/test/legacy.js#L46) | Load the built legacy bundle in a separate Node process, suppress timers, and check three exported callback functions. This does not execute a real TV service. |
| [package.json:25](../package.json#L25) | Add the separate `package:start-poc` script; existing build/package targets remain available. |
| [tools/test.js:17](../tools/test.js#L17) | Include the Starter suite in `npm test`. |

### Added implementation, packaging, and test files

| File | Contents / key locations |
| --- | --- |
| [tools/package-start-poc.js](../tools/package-start-poc.js) | `derive()` at line 16; metadata checks 26–35; IDs/configuration 37–42; web manifest 44–51; original icon 53; handoff 59–68; stale signature removal 69–71; `main()` with bundle equality check 75–84. |
| [tools/poc/start.js](../tools/poc/start.js) | Complete web orchestrator `start()`. Timers/generations from 29/58; contexts 76; ping 92; handoff validation 116; `startCobalt()` 134; `killSelected()` 182; `afterServiceReady()` 225; `testService()` 255; manual cleanup 317; remote control/diagnostics/visibility 338–389. |
| [tools/poc/start.html:23](../tools/poc/start.html#L23) | Visible diagnostics, five remote-control actions, and a log. The packager serializes the unchanged `start()` function directly into this page. |
| [tools/poc/icons/icon-cobalt.png](../tools/poc/icons/icon-cobalt.png) | Distinct red handoff test icon, 117×117, 8-bit RGBA PNG. |
| [tools/poc/icons/icon-starter.png](../tools/poc/icons/icon-starter.png) | Previous blue Starter test icon, 117×117. Retained as a historical asset, but no longer packaged after restoring the original icon. |
| [tools/test-start-poc.js](../tools/test-start-poc.js) | `harness()` at 18 and `main()` at 82; 61 packaging/runtime checks. Icon checks from 110 were adjusted for the original icon; startup/kill tests are unchanged. |

### Added documentation and backup record

| File | Purpose |
| --- | --- |
| [docs/START-POC.md](START-POC.md) | Historical isolated service test and original optional handoff. |
| [docs/COBALT-CONTEXT-POC.md](COBALT-CONTEXT-POC.md) | Historical context/double-launch/kill test with separate icons. |
| [docs/DAILY-START-TIZEN5.md](DAILY-START-TIZEN5.md) | Current operating and hardware test procedure, limitations, and build artifacts. |
| [docs/ONE-PACKAGE-TIZEN5.md](ONE-PACKAGE-TIZEN5.md) | Separate feasibility investigation, without a third WGT. |
| [docs/TIZEN5-WORKING-SNAPSHOT.json](TIZEN5-WORKING-SNAPSHOT.json) | Checksums of the saved state before the icon restoration. |
| [docs/UPSTREAM-REPORT.md](UPSTREAM-REPORT.md) | This report on the actual diff and supporting evidence. |
| [docs/UPSTREAM-ISSUE.md](UPSTREAM-ISSUE.md) | English issue draft that has not been published. |

The earlier PoC documents are marked as historical. Their previous icons, checksums,
and manual operating sequences describe the corresponding earlier state.
No additional formatting-only changes were made to upstream runtime files.
The current test adjustment follows only the changed icon contract.
`app/icon.png` itself was not modified; its contents match v1.5.1 exactly.

### Service startup and the HTTP 204 check

`testService()` verifies its own app/package identity and queries the loopback ping.
HTTP 204 avoids another service launch. Otherwise, exactly one call is made to
`tizen.application.launch('tUb3Xq7L50.TubeService', ...)`. Only its success callback
sets `serviceStarted=true`; only a subsequent HTTP 204 confirms readiness.

The existing route already comes from upstream:
[service/lib/bootRoutes.js:15](../service/lib/bootRoutes.js#L15).
Neither `/__tube/ping` nor `/diag` was introduced or modified by this workaround.
The Starter uses a 1.5 s XHR timeout, 500 ms between readiness checks, a 20 s readiness
window measured from the beginning, and an absolute 30 s overall deadline per active
startup/cleanup operation. A missing service callback is bounded by the overall deadline.

### Cobalt handoff and cleanup

The packager produces two separately installable, unsigned WGTs:

| | Starter | Handoff |
| --- | --- | --- |
| File | `tube-tizen-5.0-start-poc.wgt` | `tube-tizen-5.0-cobalt-handoff-poc.wgt` |
| Package ID | `tUb3Xq7L50` | `tUb3Xq7LCb` |
| App ID | `tUb3Xq7L50.Tube` | `tUb3Xq7LCb.TubeCobalt` |
| Name | `Tube Starter` | `Tube Cobalt` |
| Service ID | `tUb3Xq7L50.TubeService` | none |
| Icon | Original `app/icon.png`, 512×512 RGB, without conversion | Red play/arrow test icon, 117×117 RGBA |

The root pairing keys `pkgid` and `nativeID` are removed only from the Starter.
`native.userdata` is retained for the service's unchanged origin configuration.
The Starter gains `appmanager.kill`, background support, and API metadata version 5.0;
its service boot/restart flags are false. Prelaunch is disabled in both PoCs.
These are generated PoC manifests, not changes to `app/config.xml`.

The handoff retains all three native metadata entries:

```text
pkgid:          com.samsung.tv.cobalt
nativeID:       com.samsung.tv.cobalt-yt
native.userdata: --base_url=http://127.0.0.2:8099/tv --dial_name=Tube --use_eden
```

Before the handoff, the Starter validates the installed destination package ID and
these metadata entries. It uses context lists containing app/context IDs and another
HTTP 204 ping. After a handoff callback, contexts are checked immediately and after
3 s. Only if Cobalt existed before attempt 1 and none remains afterward is a second
call allowed, after 1.2 s and another context/ping check. Error callbacks are also
observed because the old context may nevertheless have disappeared.

Immediately before `kill(contextId)`, `killSelected()` rechecks that exactly one
valid instance of precisely `com.samsung.tv.cobalt-yt` has the same ID. A different
app with a colliding context ID also blocks the kill. The API attempt itself consumes
the shared budget of one kill. After success, contexts are checked immediately and
after 1.2 s; a remaining target ID or an API/context error prevents the handoff.

The existing [launchOver()](../service/lib/cobaltLaunch.js#L35) and
[relaunch()](../service/lib/cobalt.js#L57) functions were investigated, but were neither
modified nor adopted wholesale. In particular, the original `relaunch()` also
terminates contexts belonging to the app itself and proceeds even after kill errors.
The new Starter restricts cleanup to the authorized native app and verifies termination.

### Safety limits and unchanged areas

- At most one kill attempt and two handoff calls per user startup. These limits apply
  to the new Starter orchestrator, rather than providing new global control over all
  existing upstream service functions.
- Automatic cleanup requires an accepted explicit service launch **within this user
  invocation**, followed by confirmed HTTP 204. Old logs do not authorize cleanup.
- Ambiguous targets or changed IDs prevent automatic killing; the normal handoff
  proceeds with diagnostics.
- When the service is already ready, cleanup requires two deliberate confirmations.
  It shares the kill budget with automatic cleanup. A later button-triggered restart
  is a new explicit user action, not a loop.
- Generation, busy state, and an absolute deadline prevent follow-up actions from
  stale or duplicate callbacks. Hiding the page before handoff aborts the operation.
  After a deliberate handoff, only its bounded background observation is allowed.
- At the end of that observation, the hidden Starter exits itself. The code does not
  send a kill to the service or Cobalt. Making the same page visible again does not
  start another automatic attempt.
- Context lists, API success/error callbacks, and ping results are logged locally
  with timestamps; the web-storage log is limited to 24000 characters.
- No kill in service `onStart()`, no new HTTP process-management endpoint, no root,
  no runtime PC, and no modification to Samsung's original app.
- `service/index.js`, all `service/lib/*` routes/modules, `mods/*`, `framework/*`,
  `app/config.xml`, regular packaging, and dependencies remain unchanged relative to
  v1.5.1. The only service implementation exception is the legacy export line noted above.

## D. Current behavior and known limitations

**Case A — service already ready:** Reuse the existing service without a preventive
Cobalt kill. Perform a normal handoff, with at most one controlled retry if the
context disappears. If blocked, targeted manual cleanup is available while the
kill budget remains unused.

**Case B — service explicitly started:** After an accepted start and HTTP 204,
perform targeted cleanup of an unambiguous native instance. Recheck its ID before
the kill and verify its disappearance afterward. Only then perform the handoff.
No context means direct handoff; ambiguous or changed targets lead to a normal
handoff without an automatic kill.

**Original YouTube edge case, reported by the user:** When the service is already
ready, a normal handoff can reuse an original YouTube session that is still running.
An existing Cobalt context proves neither the correct base URL nor an active userscript.
Workaround: completely close original YouTube with a **long Back press**, then reopen
Tube Starter. The current logic is explicitly not being changed to address this
edge case during publication preparation.

**Boot:** No application-provided YouTube activation on power-on; prelaunch and the
PoC service boot flags are disabled. To meet the complete requirement, TV
**Autorun Last App must also be disabled**. With the APIs established so far, a
Starter visibly restored by the TV cannot reliably be distinguished from deliberate
opening. The system feature can also restore Cobalt itself. This limitation must not
be presented as guaranteed software-level prevention of startup on boot.

**Success detection:** HTTP 204 proves current local service reachability; launch
success proves only acceptance of the call; a context proves only a running process.
A fresh page acknowledgement with a session identifier has deliberately not yet
been implemented. Stored boot messages are not used as evidence of a modified session.

## E. Verification

### Automated checks performed during this preparation

- `npm run package`: internally performs the complete userscript, modern service,
  and Node 4 legacy builds, including syntax compatibility checks, and generates the
  regular packages used as input. No build script was restructured for this purpose.
- `npm run package:start-poc`: generates both separate PoCs and requires the regular
  legacy WGT to match the current legacy service build.
- `npm test`: lint and type checking pass; **299/299 userscript, 256/256 service,
  and 61/61 Starter checks pass**. Startup/kill tests remain unchanged relative to
  the saved state. Only the icon fixture and icon expectations were adjusted.
- Starter tests execute the actual serialized page in a simulated Tizen/XHR/clock
  environment: cases A/B, HTTP 204 requirement, target verification, kill/handoff
  limits, conflicts, permission denial, deadlines, late and duplicate callbacks,
  remote control, isolated service testing, and package contents.
- Every ZIP entry was read with CRC verification; manifests were parsed as XML;
  local HTML/service/icon references were resolved; IDs and unchanged native metadata
  were checked; the complete service file tree was compared with the regular legacy
  WGT and build.
- The new Starter icon was compared exactly with `git show v1.5.1:app/icon.png`.
  Starter HTML is byte-identical to the saved WGT; every extracted handoff file is
  byte-identical to the saved version. No third WGT/architecture was created.

The complete `npm test` suite ran outside the restrictive sandbox because it uses
local test ports. This was not execution on the TV and did not access the TV over
the network.

### Other existing test environments and limits of the evidence

`npm run test:matrix -- 4.4.3` was attempted, but cannot run here because `fnm` and an
installed Node 4.4.3 runtime are missing. `test:e2e` requires downloaded Playwright
browsers and live YouTube access; the browser cache here is empty. `test:cobalt`
requires Docker and a suitable Cobalt image; Docker is not installed.
These additional integration/runtime environments are not reported as passing.
The host-side test code requires modern Node; only the shipped legacy service
bundle must run on Node 4.4.3. The Starter uses ES2017 for the Tizen web browser,
not JavaScript intended to run inside the Node service.

The previous development round also tested four local Chromium scenarios with
simulated Tizen APIs: service initially offline, an existing blocking context with
manual cleanup, a disappearing context followed by a second handoff, and automatic
cleanup after explicit service startup. These were browser simulations and were not
counted as new TV tests during this icon-only round.

### Confirmed on the TV — exclusively according to the user's reports

- Explicit startup of the app's own service; HTTP 204 from the ping.
- After manual service startup, `/diag` passed 5/5 and playback/ad blocking worked.
- The separate native handoff is functional in principle.
- An existing Cobalt context caused a problem that targeted cleanup successfully resolved.
- Afterward, the handoff also worked following normal power-off/power-on.
- The current startup logic was confirmed as a working workaround on the specified The Frame.
- Possible reuse of original YouTube and the long-Back workaround described above.

There is no SDB/TV access from this environment. No independently recorded TV logs
covering a complete test matrix are available. Areas not sufficiently tested include
other models/firmware, repeated complete cold starts, all Art Mode/autorun combinations,
slow background timers, long-running sessions/updates, and every permission/race failure
on real hardware. The repackaged original icon and Smart Hub icon-cache behavior have
not yet been confirmed in a new TV test.
The [hardware test procedure](DAILY-START-TIZEN5.md) describes the targeted follow-up.

### Comparison with the saved working state

Runtime source and limits were not changed. The Git diff contains only changes or
additions to `tools/package-start-poc.js` (original icon instead of the test icon),
the corresponding icon checks in `tools/test-start-poc.js`, and documentation.

The complete build automatically incorporates the current Git state
([tools/lib/config.js:40](../tools/lib/config.js#L40)). Consequently,
`service/dist/index.js` and `service/dist/assets/userScript.js` in the new Starter
contain Git revision `6b99653` instead of `02c4d8b`. After normalizing only these two
revision values, both files are byte-identical to the backup. The boot asset and
Starter HTML are identical without normalization. Claiming a completely byte-identical
service build would be inaccurate; the difference has been verified as the diagnostic/
build revision, rather than a change to startup or service logic.

The Starter WGT grows primarily because of the original icon: 262884 bytes instead
of 7884 bytes; compressed, 262580 instead of 7889 bytes. The handoff stays small
because it contains only its manifest, placeholder HTML, and icon; the TV supplies
the engine. Archive timestamps and ZIP compression can change WGT checksums even
when the extracted files are identical.

| Current unsigned WGT | Bytes | SHA-256 |
| --- | ---: | --- |
| `tube-tizen-5.0-start-poc.wgt` | 786728 | `396a426a213328c99c2ff6816542a7c91ea2bd23e748dafaedcb9a5ec273a828` |
| `tube-tizen-5.0-cobalt-handoff-poc.wgt` | 7177 | `cba655a025aca3af557fe4ca7125ecf9639230659e93391ce6e745d5d491983f` |

All artifacts remain unsigned. Installation requires the same author signature for
updates and the appropriate partner authorization. Certificates and private keys
must not be included in the issue draft.

## F. Single-package investigation and questions for upstream

The [separate investigation](ONE-PACKAGE-TIZEN5.md) distinguishes three goals:
**one WGT**, **one app ID**, and **one visible icon**. The UI and service already
have different app IDs within the same package. The native system Cobalt app also
retains its own identity, even if only one user-facing icon were visible.

The [Tizen configuration reference](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/application/web/reference/config-xml.md)
defines exactly one regular web UI entry per widget. Services may have their own
metadata, but this does not establish native Cobalt redirection for a service entry.
[Hybrid packages](https://raw.githubusercontent.com/Samsung/tizen-docs/master/docs/application/web/guides/development/index.md)
also do not demonstrate a second web UI in the same WGT. These maintained references
are not a substitute for locally verifying the proprietary Samsung TV 5.0 installer/
launcher.

Investigated, but not demonstrated to work:

1. Direct `launch()`/`launchAppControl()` of Cobalt: reliable transfer of all
   `native.userdata` arguments without root-level pairing on the Starter is unresolved.
2. Service metadata as an internal pairing alias: XML metadata is possible, but its
   interpretation by Samsung's Cobalt launcher has not been established.
3. A second UI/nested WGT: no documented valid web package structure.
4. A general native multi-app TPK: a different package architecture, not evidence
   that these Samsung-specific parameters can be used within a single WGT.
5. A separate hidden handoff: could combine two WGTs and multiple app IDs with only
   one visible icon. Samsung lists `nodisplay` as a partner feature in its
   [Seller Office guide](https://developer.samsung.com/tv-seller-office/guides/applications/registering-application.html).
   Syntax, availability, and authorization on this 5.0 firmware remain to be confirmed.
   Both current diagnostic apps therefore retain their visible entries.

Questions for SushyDev:

- Would the legacy export correction be welcome as a small independent fix?
- Is there a supported explicit service startup path for 2019/Tizen 5.0 when native
  pairing skips the web page?
- Can the system Cobalt app reliably be started through AppControl with these
  parameters, without a second paired web entry?
- Does the launcher also interpret pairing metadata on a service component?
- Which architecture would be preferred: separate diagnostic packages, a hidden
  handoff, or another established entry path? Which Tizen 5.0 documentation or
  additional devices could help validate the decision?
- Is possible reuse of an original YouTube session a known behavior, and what
  evidence of an actually modified session would be useful upstream?

Until these questions are resolved, the two PoCs remain the fallback. No third WGT
or unverified single-package implementation is presented as complete or functional.
