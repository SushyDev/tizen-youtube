// json-routing takes over the process's JSON.parse, so it cannot share a process with the rest.

import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = [
    'framework/feed.js', 'mods/feed.js', 'framework/core.js', 'framework/json-routing.js',
    'mods/settings.js', 'mods/adblock.js', 'mods/feed-mods.js', 'mods/player-mods.js',
    'mods/dearrow.js', 'mods/dislike/count.js', 'mods/dislike/puzzle.js', 'mods/dislike/vote.js',
    'mods/dislike/sync.js', 'mods/playerButtons.js', 'mods/startPage.js', 'mods/scroller.js',
    'mods/subtitles.js', 'mods/sponsorblock/index.js', 'mods/sponsorblock/autoSkip.js',
    'mods/quality.js', 'framework/wait-for.js', 'dom-shims.js', 'mods/network/originRewrite.js',
    'mods/network/pageOrigin.js', 'framework/journal.js'
];

const failed = SUITES.filter((suite) => {
    try {
        execFileSync(process.execPath, [join(HERE, suite)], { stdio: 'inherit' });
        return false;
    } catch (e) {
        return true;
    }
});

process.exit(failed.length ? 1 : 0);
