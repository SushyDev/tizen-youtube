# Developing

## Commands

| | |
| --- | --- |
| `npm run doctor` | Check prerequisites when something looks wrong |
| `npm run build` | Userscript and service |
| `npm run typecheck` | `tsc --noEmit` on its own |
| `npm test` | Lint, types, then the userscript and service suites |
| `npm run package` | Build an unsigned `.wgt` for Tizen Homebrew |
| `npm run release` | Stage `release/origin/` — the userscript, the language names and `latest.json` |
| `npm run dev` | YouTube with the mods in a browser, no hardware needed |
| `npm run dev:service` | The service off-TV, on `:8099` |
| `npm run chii` | Remote inspector for the page inside the container |
| `npm run version:set 1.2.0` | Set the version everywhere it is written |
| `npm run clean` | Remove every build artefact |

## Remote inspector

The page inside Cobalt has no console. `npm run chii` starts one here and prints the `TUBE_CHII`
value to build against; the widget then carries chii's target script and opens the socket back
through the proxy. Both halves have to be addressed to youtube.com — Cobalt sends HTTP through
`--proxy` but not WebSockets, so a socket opened straight at this machine cannot leave the
container and closes 1006.

```
npm run chii                                    # leave it running
TUBE_CHII=192.168.1.103:8711 npm run deploy     # bake the address into the widget
```

It attaches only when asked, and forgets being asked the moment it has read it: an inspector that
attaches on every boot is one bad build away from a television that will not start, and the only
way back from that is a reinstall. Arm it through the dev bridge, then reopen the app on the set —
installing does not reload the page.

```
curl -X POST http://192.168.1.29:8097/eval -H 'x-tube-token: tvdebug2026' \
     --data-binary "localStorage.setItem('tube.inspector', 'on')"
```

Then open <http://localhost:8711> and pick the target. If `/__tube/chii/target.js` on the set
answers 502, nothing is listening here — `npm run chii` is not running.
