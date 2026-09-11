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
| `npm run version:set 1.2.0` | Set the version everywhere it is written |
| `npm run clean` | Remove every build artefact |
