# Tizen 5.0 / The Frame 2019: working explicit TubeService start with a separate Cobalt handoff — architecture feedback

Hi SushyDev,

Thank you for the project. I have been testing v1.5.1 on a Samsung The Frame 2019
and have a working local workaround for a service-start problem. Before preparing
a PR, I would appreciate your advice on the preferred integration, particularly
whether the native Cobalt handoff can be retained without a second WGT.

## Device and original failure

- Samsung QE55LS03RAUXZG (The Frame, 2019)
- Tizen 5.0; Node.js 4.4.3 in the service runtime
- App: `tUb3Xq7L50.Tube`
- Service: `tUb3Xq7L50.TubeService`, TCP 8099
- Installed test packages signed with a Samsung partner certificate

With the original v1.5.1 package, TubeService did not start after a complete TV
restart or when opening the app. YouTube consequently showed a network error.
Running the following command started the service successfully:

```sh
sdb shell 0 execute tUb3Xq7L50.TubeService
```

After that, `/diag` passed 5/5 checks and playback, including ad blocking, worked.
A launcher in a different package could not start the service because of the
cross-package service restriction. The existing native Cobalt pairing also skips
the web entry page, so adding a launch call to the original HTML alone would not
put it before the native launch.

## Changes in the working local version

The small independent source fix is in `service/legacy/index.js`:

```diff
-require('../index.js');
+module.exports = require('../index.js');
```

A regression test loads the built legacy bundle and verifies exported `onStart`,
`onRequest`, and `onStop` functions. This fix did **not** by itself resolve automatic
service startup on this TV. We have not established why the firmware does not
honor the original boot/restart configuration as expected.

The working workaround uses two separately installable WGTs:

1. **Tube Starter:** retains `tUb3Xq7L50.Tube` and its own TubeService. The generated
   manifest removes the UI's native pairing so a web entry page can run first.
2. **Tube Cobalt:** package `tUb3Xq7LCb`, app `tUb3Xq7LCb.TubeCobalt`; no service.
   It preserves the existing native pairing and arguments:

```text
pkgid:          com.samsung.tv.cobalt
nativeID:       com.samsung.tv.cobalt-yt
native.userdata: --base_url=http://127.0.0.2:8099/tv --dial_name=Tube --use_eden
```

On a deliberate Starter opening:

- If `http://127.0.0.2:8099/__tube/ping` already returns **HTTP 204**, reuse the
  service and attempt the normal handoff without a preventive Cobalt kill.
- Otherwise launch the **own-package** service explicitly, wait for its success
  callback and then HTTP 204, with bounded readiness/overall timeouts.
- Only in that second case, if there is exactly one valid
  `com.samsung.tv.cobalt-yt` context, revalidate its context ID immediately before
  one targeted `application.kill()` call. Verify that ID has disappeared before
  attempting the handoff. A failed ping alone never authorizes the cleanup, and
  an accepted launch does not prove that a new service process was created.
- If the first handoff removes a previously observed Cobalt context, recheck after
  a short delay and allow at most one second handoff. Ambiguous or changing kill
  targets are left alone; the normal handoff/diagnostic path remains available.

A blocked normal handoff can offer a separately confirmed manual cleanup. Automatic
and manual cleanup share a maximum of **one kill attempt per user start**, alongside
**two handoff attempts**. Kill errors or a target that remains present after a kill
stop that path; there is no kill fallback or unbounded retry.

All process management is performed locally through the Tizen API, with the partner
`appmanager.kill` privilege. There is no new HTTP process-management endpoint, no
kill in service `onStart()`, no root requirement, no runtime PC, and no modification
to Samsung's original YouTube app. Existing service routes and Cobalt library
functions have not been rewritten. The UI retains a service-only diagnostic mode
and logs app/context IDs, callbacks, failures, and current ping results.

The main added files are `tools/poc/start.js`, `tools/poc/start.html`,
`tools/package-start-poc.js`, and `tools/test-start-poc.js`. The new packaging command
is `npm run package:start-poc`; its input is the regular legacy WGT. The Starter now
uses the original v1.5.1 project icon, while the handoff keeps a distinct test icon.
The detailed local development report is prepared as `docs/UPSTREAM-REPORT.md`;
these local files are not being represented as already available upstream.

## Validation and known limitations

The current startup workaround has been reported working on the physical TV above.
Earlier device tests confirmed explicit service startup, HTTP 204, native handoff,
and successful targeted cleanup. The handoff subsequently also worked after normal
power-off/power-on. This is one device's result, not a claim covering all Tizen 5.0 TVs.

The latest full build and standard `npm test` pass locally: **299 userscript,
256 service, and 61 Starter checks**, plus lint and type checking. The Starter tests
use simulated Tizen APIs and time; they are not hardware tests. Four additional
Chromium simulations were run during development. ZIP integrity, manifest paths,
full legacy service/assets, unchanged handoff metadata, and restored icon contents
have also been checked. An additional Node-4.4.3 matrix run is blocked here by the
missing runtime manager; the separate live E2E/Docker test environments are not
available. Hardware tests were performed separately from the development environment,
which has no direct TV access. The newly repackaged icon has not yet been checked on-TV.

Remaining limitations:

- An already running original YouTube session can be reused by the normal handoff
  when the service is already available. The current workaround is to fully close
  original YouTube with a **long Back press**, then reopen Tube Starter. This behavior
  is documented rather than changed in this publication-preparation step.
- A launch-success callback or a Cobalt context is not proof that the modified page
  is running. No stale boot log is used as such proof. A fresh per-session page
  acknowledgement is deliberately deferred.
- There is no application-provided boot launch; prelaunch and the PoC service boot
  flags are disabled. TV **Autorun Last App must also be disabled**, since a visible
  TV-driven restore cannot currently be reliably distinguished from manual opening.
- More cold-start, standby/Art Mode, background-timer, long-running and additional
  firmware/model testing is still needed. The latest icon-only rebuild retains the
  saved runtime source; only the icon/manifest reference and automatic Git build
  revision differ in the generated Starter contents.
- The two generated WGTs remain unsigned build artifacts and need appropriate
  signing before installation.

## Preferred architecture?

The remaining drawback is the second installable package and its extra icon.
A single visible icon is not necessarily a single WGT or a single app ID.
The documented WGT model has one web UI plus services. Moving native pairing back
to that UI would again skip the Starter. Service metadata exists, but I have not
verified that Samsung interprets Cobalt pairing keys on a service entry. Likewise,
a direct `launchAppControl()` has not been shown to preserve the native arguments.
No unverified third/single-WGT package has been created.

Would you recommend:

1. Submitting the legacy lifecycle export fix separately?
2. Keeping the two-package approach, potentially hiding the handoff through a
   supported partner `nodisplay` configuration? Its Tizen 5.0 syntax/behavior still
   needs verification.
3. A supported direct Cobalt AppControl or same-package entry that receives these
   arguments while allowing the web Starter to run first?
4. Another startup mechanism for the 2019/Tizen 5.0 firmware, or a preferred way to
   establish whether the existing Cobalt session is actually the modified one?

I would be happy to adapt the approach to the project's preferred architecture
once that interface is clearer. For now, the working two-package version is kept
as the fallback, and this is an issue draft for review rather than a submitted PR.
