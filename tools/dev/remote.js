'use strict';

// A keyboard standing in for the TV remote, injected into the page by the dev service.
//
// A function declaration rather than the usual module shape: this is a classic script injected
// afresh on every dev reload, and a top-level `const` would throw "already declared" the second
// time. Function declarations may be redeclared, so re-injection is simply a reinstall.

function tubeRemoteInstall() {
    const KEYS = {
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

    // Cobalt's engine has KeyboardEvent; the fallback is for anything that does not.
    const eventFor = (type) => {
        try {
            return new KeyboardEvent(type, { bubbles: true, cancelable: true });
        } catch (e) {
            const legacy = document.createEvent('Event');
            legacy.initEvent(type, true, true);
            return legacy;
        }
    };

    // keyCode is read-only on a constructed event, so it is defined onto it rather than passed in.
    const press = (code) => ['keydown', 'keypress', 'keyup'].forEach((type) => {
        const event = eventFor(type);
        Object.defineProperty(event, 'keyCode', { get: () => code });
        Object.defineProperty(event, 'which', { get: () => code });
        document.dispatchEvent(event);
    });

    const isTyping = (target) => {
        if (!target) return false;
        const name = (target.tagName || '').toLowerCase();
        return name === 'input' || name === 'textarea' || target.isContentEditable === true;
    };

    document.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (isTyping(event.target)) return;

        const mapped = KEYS[event.key];
        if (!mapped) return;

        event.preventDefault();
        event.stopPropagation();
        press(mapped.code);
    }, true);

    window.tubeRemote = press;
    window.tubeRemote.keys = KEYS;

    console.log(
        '%ctube dev remote%c  ' +
        Object.keys(KEYS).map((key) => `${key} = ${KEYS[key].what}`).join('  ·  ') +
        '\n                  tubeRemote(keyCode) presses anything else',
        'background:#c00;color:#fff;padding:1px 4px;border-radius:2px', ''
    );
}

tubeRemoteInstall();
