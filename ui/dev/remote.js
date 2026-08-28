// A television remote, for a desk.
//
// Development only. The service injects this into the proxied page alongside
// the userscript when `npm run dev` started it — see TUBE_DEV_INJECT in
// service/lib/proxy.js. Nothing reaches a TV: it is not imported by anything
// under mods/ or service/, and the service only serves it when the launcher
// hands it a path.
//
// It exists because the interesting keys are not on a keyboard. The settings
// panel opens on the green button, which is keyCode 404, and no key on a
// laptop produces that — so without this the panel this app is largely about
// cannot be opened in a browser at all. The same goes for the coloured keys,
// the transport keys, and Return, which is how you leave anything.
//
// The mapping is one letter per remote button rather than a chord, because
// the point is to be able to drive the interface with one hand while reading
// the screen. Letters typed into a real field are left alone.

(function () {
    'use strict';

    // Samsung's TV key codes, as the app sees them. mods/ui/ui.js reads 404
    // for the panel and mods/ui/speedUI.js reads 406 for the speed control.
    var KEYS = {
        g: { code: 404, what: 'green — additional options' },
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

    // The app listens for `keydown`, `keypress` and `keyup` on the document,
    // in the capture phase, and reads `keyCode` — which a constructed event
    // will not carry, so it is defined on the way past.
    function press(code) {
        ['keydown', 'keypress', 'keyup'].forEach(function (type) {
            var event;
            try {
                event = new KeyboardEvent(type, { bubbles: true, cancelable: true });
            } catch (e) {
                // Older engines: this file also runs against the legacy bundle.
                event = document.createEvent('Event');
                event.initEvent(type, true, true);
            }

            Object.defineProperty(event, 'keyCode', { get: function () { return code; } });
            Object.defineProperty(event, 'which', { get: function () { return code; } });

            document.dispatchEvent(event);
        });
    }

    // Anything the user could be typing into is left alone, so the on-screen
    // keyboard and any real field keep working.
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

    // So a script — or the devtools console — can press anything at all,
    // including the keys with no letter above.
    window.tubeRemote = press;
    window.tubeRemote.keys = KEYS;

    console.log(
        '%ctube dev remote%c  ' +
        Object.keys(KEYS).map(function (key) { return key + ' = ' + KEYS[key].what; }).join('  ·  ') +
        '\n                  tubeRemote(keyCode) presses anything else',
        'background:#c00;color:#fff;padding:1px 4px;border-radius:2px', ''
    );
}());
