(function () {
    'use strict';

    var KEYS = {
        g: { code: 404, what: 'green' },
        r: { code: 403, what: 'red' },
        y: { code: 405, what: 'yellow' },
        b: { code: 406, what: 'blue — playback speed' },
        p: { code: 10252, what: 'play/pause' },
        s: { code: 413, what: 'stop' },
        ',': { code: 412, what: 'rewind' },
        '.': { code: 417, what: 'fast forward' },
        '[': { code: 10232, what: 'previous track' },
        ']': { code: 10233, what: 'next track' },
        Escape: { code: 10009, what: 'return' },
        Backspace: { code: 10009, what: 'return' }
    };

    function press(code) {
        ['keydown', 'keypress', 'keyup'].forEach(function (type) {
            var event;
            try {
                event = new KeyboardEvent(type, { bubbles: true, cancelable: true });
            } catch (e) {
                event = document.createEvent('Event');
                event.initEvent(type, true, true);
            }

            Object.defineProperty(event, 'keyCode', { get: function () { return code; } });
            Object.defineProperty(event, 'which', { get: function () { return code; } });

            document.dispatchEvent(event);
        });
    }

    function isTyping(target) {
        if (!target) return false;
        var name = (target.tagName || '').toLowerCase();
        return name === 'input' || name === 'textarea' || target.isContentEditable === true;
    }

    document.addEventListener('keydown', function (event) {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (isTyping(event.target)) return;

        var mapped = KEYS[event.key];
        if (!mapped) return;

        event.preventDefault();
        event.stopPropagation();
        press(mapped.code);
    }, true);

    window.tubeRemote = press;
    window.tubeRemote.keys = KEYS;


    // --- the player's transport row ------------------------------------------------
    //
    // The row under the player comes up as grey placeholder pills and fills in one shot
    // when the watch data lands, which on a fast connection is about half a second. That
    // window is far too short to catch by hand, so it is watched from the first frame of
    // every load and kept here to read back afterwards.
    //
    //   tubeRow()          the last 40 changes of the row
    //   tubeRow(200)       more of them
    //   tubeRow.clear()    start a fresh recording
    //   tubeSkeleton()     replay the whole thing and hand back the log
    //
    // PH is one of YouTube's grey placeholders, BTN is something focusable, so the
    // skeleton window is every entry before the placeholders turn into buttons.

    var watched = { log: [], last: null, since: Date.now() };

    function describeSlot(slot) {
        var button = slot.querySelector('[role="button"]');
        if (button) return 'BTN ' + (button.getAttribute('aria-label') || '(unlabelled)');
        return 'PH ' + String(slot.className || '').split(' ')[0];
    }

    function describeRow() {
        var container = document.querySelector('ytlr-player-actions-container');
        if (!container) return null;

        return Array.prototype.map.call(container.children, function (group) {
            return Array.prototype.map.call(group.children, describeSlot).join(' | ');
        }).join('   ///   ');
    }

    function focusedLabel() {
        var button = document.querySelector('[role="button"].zylon-focus');
        return button ? (button.getAttribute('aria-label') || '(unlabelled)') : 'none';
    }

    function playing() {
        var media = document.querySelector('video');
        if (!media) return '-';
        return media.readyState + (media.paused ? 'p' : '>');
    }

    setInterval(function () {
        var row = describeRow();
        var line = row === null ? '(no row)'
            : row + '   FOCUS=' + focusedLabel() + '   V=' + playing();

        if (line === watched.last) return;

        watched.last = line;
        watched.log.push({ t: Date.now() - watched.since, line: line });
        if (watched.log.length > 400) watched.log.shift();
    }, 20);

    window.tubeRow = function (count) { return watched.log.slice(-(count || 40)); };
    window.tubeRow.clear = function () {
        watched.log = [];
        watched.last = null;
        watched.since = Date.now();
    };

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function until(done, seconds) {
        var deadline = Date.now() + (seconds || 10) * 1000;

        return new Promise(function (resolve) {
            (function look() {
                if (done() || Date.now() > deadline) return resolve(done());
                setTimeout(look, 50);
            }());
        });
    }

    var SELECT = 13;
    var RETURN = 10009;

    function onWatch() { return location.hash.indexOf('watch') >= 0; }
    function media() { return document.querySelector('video'); }

    // Home, then the first tile on the shelf. There is no shortcut: YouTube TV will not
    // deep-link, so pointing location.hash at a watch route leaves the old page mounted
    // and the mods running on whatever config they read at load. Going home is what tears
    // the player down, and opening a tile is what builds it again.
    window.tubeSkeleton = async function () {
        var i;

        for (i = 0; i < 12 && onWatch(); i++) { press(RETURN); await sleep(300); }
        await until(function () { return !onWatch() && document.querySelector('[class*="tile"]'); }, 15);
        await sleep(800);

        window.tubeRow.clear();

        press(SELECT);                              // open the first video on the shelf
        await until(onWatch, 10);
        await sleep(200);
        press(SELECT);                              // raise the controls

        // Pausing before it is really rolling only toggles play, and autoplay undoes it.
        await until(function () {
            var video = media();
            return video && video.readyState >= 3 && !video.paused && video.currentTime > 0.3;
        }, 20);

        for (i = 0; i < 3 && !(media() && media().paused); i++) { press(SELECT); await sleep(350); }
        await sleep(1500);

        var settings = {};
        try { settings = JSON.parse(window.localStorage['tube.settings'] || '{}'); } catch (e) { /* defaults */ }

        return {
            patched: settings.enablePatchingVideoPlayer !== false,
            route: location.hash,
            paused: !!(media() && media().paused),
            log: watched.log.slice()
        };
    };

    // --- which UI this device was served ---------------------------------------
    //
    // None of the look is in the bundle. The JS and the CSS are one build for every
    // device — every variant's class names are in both — and what picks between them
    // is window.environment, which the server writes into the /tv page: the flags, the
    // feature switches, and the Mendel experiment ids that chose them. Two televisions
    // on the same firmware and the same client version land in different slices and so
    // wear different UI. Reading it is the only way to tell which one this is.
    //
    //   tubeEnv()          identity, experiments, and the switches the app resolved
    //   tubeEnv.copy()     the same as JSON, to carry off the television
    //   tubeEnv.diff(o)    what this session has that a pasted-back one did not

    function environment() { return window.environment || {}; }
    function tectonic() { return window.tectonicConfig || {}; }

    function identity() {
        var env = environment();
        // ytcfg.data_ is empty once yt.config_ takes over, so go through the getter.
        var read = function (key, fallback) {
            try { return window.ytcfg.get(key, fallback); } catch (e) { return fallback; }
        };
        var device = read('DEVICE_EXPERIMENT_ID_DEBUG_INFO', {}) || {};

        return {
            client: env.client_name + ' ' + env.client_version,
            build: window.label || '',
            device: [env.brand, env.model, env.os, env.os_version].filter(Boolean).join(' '),
            country: env.country,
            loggedIn: read('LOGGED_IN', false) === true,
            // The bucket. Everything below is downstream of this number.
            deviceExperimentId: String(device.mendelDeviceExperimentId || ''),
            visitor: String(env.visitor_data || '').slice(0, 24),
            limitedAnimation: env.is_limited_animation === true,
            appQuality: (tectonic().clientData || {}).legacyApplicationQuality || ''
        };
    }

    window.tubeEnv = function () {
        var env = environment();

        return {
            identity: identity(),
            experiments: (env.experiments || []).slice(),
            flags: env.flags || {},
            featureSwitches: env.feature_switches || {},
            // What the app actually reads, after it has folded the flags together.
            resolved: tectonic().featureSwitches || {}
        };
    };

    window.tubeEnv.copy = function () { return JSON.stringify(window.tubeEnv()); };

    // Pass a tubeEnv() taken on another screen — pasted back, or its JSON — and this
    // reports what this session was given that the other one was not.
    window.tubeEnv.diff = function (other) {
        if (typeof other === 'string') other = JSON.parse(other);
        if (!other) return 'pass a tubeEnv() from the other screen';

        var mine = window.tubeEnv();
        var report = { identity: {}, experiments: { onlyHere: [], onlyThere: [] } };

        Object.keys(mine.identity).forEach(function (key) {
            if (mine.identity[key] !== (other.identity || {})[key]) {
                report.identity[key] = { here: mine.identity[key], there: (other.identity || {})[key] };
            }
        });

        var theirs = {};
        (other.experiments || []).forEach(function (id) { theirs[id] = true; });
        mine.experiments.forEach(function (id) { if (!theirs[id]) report.experiments.onlyHere.push(id); });

        var here = {};
        mine.experiments.forEach(function (id) { here[id] = true; });
        (other.experiments || []).forEach(function (id) { if (!here[id]) report.experiments.onlyThere.push(id); });

        ['flags', 'featureSwitches', 'resolved'].forEach(function (bag) {
            var changed = {};
            var theirBag = other[bag] || {};
            var names = Object.keys(mine[bag]).concat(Object.keys(theirBag));

            names.forEach(function (name) {
                if (Object.prototype.hasOwnProperty.call(changed, name)) return;

                var a = JSON.stringify(mine[bag][name]);
                var b = JSON.stringify(theirBag[name]);
                if (a !== b) changed[name] = { here: mine[bag][name], there: theirBag[name] };
            });

            report[bag] = changed;
        });

        return report;
    };

    console.log(
        '%ctube dev remote%c  ' +
        Object.keys(KEYS).map(function (key) { return key + ' = ' + KEYS[key].what; }).join('  ·  ') +
        '\n                  tubeRemote(keyCode) presses anything else' + '\n                  tubeSkeleton() replays the player UI  ·  tubeRow() reads the row back' +
        '\n                  tubeEnv() reads the flags this device was served',
        'background:#c00;color:#fff;padding:1px 4px;border-radius:2px', ''
    );
}());
