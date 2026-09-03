// A television remote, for a desk. Development only: the service injects this into the
// proxied page alongside the userscript when `npm run dev` started it. The colour buttons
// are keyCodes no laptop key produces.

(function () {
    'use strict';

    // Samsung's TV key codes, as the app sees them.
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

    // The app listens on the document in the capture phase and reads `keyCode`, which a
    // constructed event does not carry — so it is defined on the way past.
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

    // Anything the user could be typing into is left alone.
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

    console.log(
        '%ctube dev remote%c  ' +
        Object.keys(KEYS).map(function (key) { return key + ' = ' + KEYS[key].what; }).join('  ·  ') +
        '\n                  tubeRemote(keyCode) presses anything else',
        'background:#c00;color:#fff;padding:1px 4px;border-radius:2px', ''
    );
}());
