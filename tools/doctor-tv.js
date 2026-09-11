'use strict';

// Whether the places we reach into YouTube are still there, asked of a television.
//
//   node tools/doctor-tv.js [--tv 192.168.1.29]

const ui = require('./report.js');
const { evaluate, settings, PORT } = require('./bridge.js');

const WHERE = settings();

// Each check returns an empty string when the reach-in holds, and what is wrong when it does not.
const inThePage = (page) => {
    const yttv = page._yttv || {};
    const keys = Object.keys(yttv);

    const resolves = keys.some((key) => {
        try {
            const value = yttv[key];
            return value && value.instance && typeof value.instance.resolveCommand === 'function';
        } catch (e) {
            return false;
        }
    });

    const switchesServed = () => {
        const config = page.tectonicConfig;
        if (!config || !config.featureSwitches) return 'window.tectonicConfig.featureSwitches is absent';

        const missing = ['verticalListDurationMs', 'horizontalListDurationMs']
            .filter((name) => config.featureSwitches[name] === undefined);
        return missing.length ? `the set is served no ${missing.join(' or ')}` : '';
    };

    const list = page.document.querySelector('yt-virtual-list');
    const component = list && list.__instance;

    return JSON.stringify({
        'the module registry': keys.length > 500 ? '' : `window._yttv holds ${keys.length} entries`,
        'the command resolver': resolves ? '' : 'no registry entry carries instance.resolveCommand',
        'the feature switches': switchesServed(),
        'the feed list': list
            ? (component ? '' : 'yt-virtual-list no longer exposes __instance')
            : 'no yt-virtual-list is on screen — open a feed and run this again',
        'its key handler': component
            ? (typeof component.onKeyDown === 'function' ? '' : 'the component has no onKeyDown')
            : 'not asked: no component',
        'its move gate': component && component.j
            ? (typeof component.j.isActive === 'function' ? '' : 'the driver has no isActive')
            : 'not asked: no driver on the component',
        'our own bundle': typeof page.__TUBE_NATIVE_PROXY_PATCHES__ !== 'undefined'
            ? '' : 'the page was not dressed by the proxy'
    });
};

const source = `(${inThePage})(window)`;

const main = async () => {
    ui.heading('doctor: television');
    ui.info('set', `${WHERE.tv}:${PORT}`);
    ui.blank();

    const checks = JSON.parse(JSON.parse(await evaluate(source, WHERE)));
    const names = Object.keys(checks);
    const broken = names.filter((name) => checks[name] !== '');

    names.forEach((name) => (checks[name] === ''
        ? ui.ok(name, 'still there')
        : ui.fail(name, checks[name])));

    ui.blank();

    if (broken.length) {
        ui.note(`${broken.length} of ${names.length} are gone. A build shipped on this would run `
            + 'and do nothing.');
        process.exit(1);
    }

    ui.note(`All ${names.length} reach-ins answer.`);
};

main().catch((error) => ui.crash(error));
