# Developing

## Commands

| | |
| --- | --- |
| `npm run doctor` | Check prerequisites when something looks wrong |
| `npm run build` | Boot screen, userscript, service |
| `npm test` | Lint, then the mods and service suites |
| `npm run package` | Build an unsigned `.wgt` for Tizen Homebrew |
| `npm run release` | Stage `release/origin/` — the userscript, the language names and `latest.json` |
| `npm run dev` | The whole app in a browser, no hardware needed |
| `npm run dev:boot` | Just the boot screen, held on screen so it can be looked at |
| `npm run dev:service` | The service off-TV, on `:8099` |
| `npm run version:set 1.2.0` | Set the version everywhere it is written |
| `npm run clean` | Remove every build artefact |
