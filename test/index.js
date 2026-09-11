// Every userscript suite, in one process each.
//
// json-routing takes over the process's JSON.parse, so it cannot share with the rest.

import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = ['feed.js', 'surfaces.js', 'framework.js', 'json-routing.js', 'settings.js', 'adblock.js', 'deArrow.js', 'playerButtons.js', 'startPage.js', 'scrollSpeed.js', 'subtitles.js', 'sponsorblock.js', 'quality.js', 'wait-for.js', 'dom-shims.js'];

const failed = SUITES.filter((suite) => {
    try {
        execFileSync(process.execPath, [join(HERE, suite)], { stdio: 'inherit' });
        return false;
    } catch (e) {
        return true;
    }
});

process.exit(failed.length ? 1 : 0);
