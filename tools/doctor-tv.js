'use strict';

// Whether the places we reach into YouTube are still there, asked of a television.
//
//   node tools/doctor-tv.js [--tv 192.168.1.29]
//
// Every one of these fails silently. A renamed method, a moved field or a marker that no longer
// matches leaves the feature doing nothing at all, on a build that passed every check there is —
// nothing in CI can see them, because none of it runs against YouTube on a set. This is the check
// that can, and it is why it is a tool rather than a workflow step.
//
// Run it against a debug build after a YouTube update, and before tagging a release.

const ui = require('./report.js');
const { evaluate, settings } = require('./bridge.js');

const at = (flag, fallback) => {
    const found = process.argv.indexOf(flag);
    return found === -1 ? fallback : process.argv[found + 1];
};

const WHERE = { tv: at('--tv', settings().tv), token: settings().token };

// Each answers with the empty string when it is still there, and with what is wrong when it is
// not. Run in the page, because that is the only place any of it exists.
const source = `(function () {
    var checks = {};
    var yttv = window._yttv || {};

    checks['the module registry'] = Object.keys(yttv).length > 500
        ? '' : 'window._yttv holds ' + Object.keys(yttv).length + ' entries';

    checks['the command resolver'] = (function () {
        var found = Object.keys(yttv).some(function (key) {
            try {
                var value = yttv[key];
                return value && value.instance && typeof value.instance.resolveCommand === 'function';
            } catch (e) { return false; }
        });
        return found ? '' : 'no registry entry carries instance.resolveCommand';
    }());

    checks['the home fallback'] = (function () {
        var found = Object.keys(yttv).some(function (key) {
            try {
                var value = yttv[key];
                if (typeof value !== 'function') return false;
                var body = value.toString();
                return body.indexOf('callToCastCommand') !== -1 && body.indexOf('clientTheme') !== -1;
            } catch (e) { return false; }
        });
        return found ? '' : 'no function matches callToCastCommand and clientTheme';
    }());

    checks['the feature switches'] = (function () {
        var config = window.tectonicConfig;
        if (!config || !config.featureSwitches) return 'window.tectonicConfig.featureSwitches is absent';
        var names = ['verticalListDurationMs', 'horizontalListDurationMs'];
        var missing = names.filter(function (name) {
            return config.featureSwitches[name] === undefined;
        });
        return missing.length ? 'the set is served no ' + missing.join(' or ') : '';
    }());

    var list = document.querySelector('yt-virtual-list');
    var component = list && list.__instance;

    checks['the feed list'] = list
        ? (component ? '' : 'yt-virtual-list no longer exposes __instance')
        : 'no yt-virtual-list is on screen — open a feed and run this again';

    checks['its key handler'] = component
        ? (typeof component.onKeyDown === 'function' ? '' : 'the component has no onKeyDown')
        : 'not asked: no component';

    checks['its move gate'] = component && component.j
        ? (typeof component.j.isActive === 'function' ? '' : 'the driver has no isActive')
        : 'not asked: no driver on the component';

    checks['our own bundle'] = typeof window.__TUBE_NATIVE_PROXY_PATCHES__ !== 'undefined'
        ? '' : 'the page was not dressed by the proxy';

    checks['the route the app writes'] = typeof window.location.hash === 'string'
        ? '' : 'location.hash is not readable';

    return JSON.stringify(checks);
}())`;

const main = async () => {
    ui.heading('doctor: television');
    ui.info('set', `${WHERE.tv}:8097`);
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
