// The page the app opens on.
//
// Two halves, because the app decides where it lands twice. The URL below is the one the container
// really launches with, read off the set: `/tv` with the parameters Cobalt appends, and an empty
// hash. The commands below are the shapes kabuki resolves once an account has changed, where an
// absent nextEndpoint and a home one mean the same thing — `nextEndpoint || <home>` is how each of
// them reads the field.
//
// What the app does with either is kabuki's business. What is checked here is that the launch
// parameter lands in the right place and is absent when nothing is chosen; that a command already
// saying where to go is left saying it; and that the command still reaches YouTube, because
// claiming it would take the account work with it.

import assert from 'assert';

const LAUNCHED_WITH = '?&additionalDataUrl=http%3A%2F%2Flocalhost%3A8080%2Fws%2Fapps%2FTube%2Fdial_data'
    + '&launch=menu';

const written = [];
const answered = [];

// A Location whose hash records what is written to it, and — as in the container — a history
// object with no replaceState on it, so a version reaching for one fails here too.
global.window = {
    localStorage: { 'tube.settings': '{}' },
    addEventListener: () => undefined,
    location: { pathname: '/tv', search: LAUNCHED_WITH, set hash(value) { written.push(value); } },
    history: {},
    // What claimCommands looks for: the registry entry holding YouTube's own resolver.
    _yttv: {
        resolver: {
            instance: {
                resolveCommand: (command) => {
                    answered.push(command);
                    return 'youtube answered';
                }
            }
        }
    }
};
global.window.JSON = JSON;
global.document = { querySelector: () => null, addEventListener: () => undefined };

const { configRead, configWrite } = await import('../framework/config.js');
const { claimCommands } = await import('../framework/commands.js');
const { start } = await import('../mods/shell/startPage.js');

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 6).join('\n      ')}`);
    }
};

const withPage = (page, run) => {
    const before = configRead('startupPage');
    written.length = 0;
    answered.length = 0;
    configWrite('startupPage', page);

    try {
        start();
        run(written);
    } finally {
        configWrite('startupPage', before);
    }
};

const LIBRARY = { browseEndpoint: { browseId: 'FElibrary' } };
const HOME = { browseEndpoint: { browseId: 'default' } };

// -- at launch ---------------------------------------------------------------------------------

check('a chosen page becomes the launch parameter that opens it', () => {
    withPage('FEsubscriptions', (hashes) => {
        assert.deepStrictEqual(hashes, ['/browse?c=FEsubscriptions']);
    });
});

// Only the fragment is written, so the parameters the container launched with — the DIAL data a
// cast arrives on among them — are still in the URL beside it. Dropping those would take a cast
// launch with them.
check('the parameters the container launched with are left alone', () => {
    withPage('FElibrary', () => {
        assert.strictEqual(global.window.location.search, LAUNCHED_WITH);
    });
});

check('Home writes nothing at all', () => {
    withPage('', (hashes) => {
        assert.deepStrictEqual(hashes, []);
    });
});

check('a stored page is spelled into the parameter rather than trusted into it', () => {
    withPage('FE topics&v=dQw4w9WgXcQ', (hashes) => {
        assert.deepStrictEqual(hashes, ['/browse?c=FE%20topics%26v%3DdQw4w9WgXcQ']);
    });
});

// A Location that refuses the write is what the try/catch is for; kabuki wraps its own for the
// same reason. The check is that startup carries on, not that anything is logged.
check('a Location that refuses the write does not take startup down with it', () => {
    const before = configRead('startupPage');
    const location = global.window.location;
    const warn = console.warn;

    global.window.location = { set hash(value) { throw new Error('not supported'); } };
    console.warn = () => undefined;
    configWrite('startupPage', 'FEsubscriptions');

    try {
        assert.doesNotThrow(start);
    } finally {
        console.warn = warn;
        global.window.location = location;
        configWrite('startupPage', before);
    }
});

// -- after an account changes ------------------------------------------------------------------

// Through the real patch rather than past it: claimCommands wraps the resolver above, so what
// these ask is what the app would ask.
assert.ok(claimCommands(), 'the resolver patch must take');

const resolve = (command) => global.window._yttv.resolver.instance.resolveCommand(command);

check('an account switch with nowhere to go is sent to the chosen page', () => {
    withPage('FElibrary', () => {
        const command = { onIdentityChanged: { identityActionContext: {}, isSameIdentity: false } };

        assert.strictEqual(resolve(command), 'youtube answered', 'the command must still reach YouTube');
        assert.deepStrictEqual(command.onIdentityChanged.identityActionContext.nextEndpoint, LIBRARY);
    });
});

// The field is absent on some paths and set to the home endpoint on others; both read as home, so
// both are replaced. Leaving the home one alone is the account-switch bug this half exists for.
check('an account switch pointed at home is sent to the chosen page', () => {
    withPage('FElibrary', () => {
        const command = { startAccountSelectorCommand: { items: [], nextEndpoint: HOME } };

        resolve(command);
        assert.deepStrictEqual(command.startAccountSelectorCommand.nextEndpoint, LIBRARY);
    });
});

check('a command that already says where to go keeps saying it', () => {
    withPage('FElibrary', () => {
        const watch = { watchEndpoint: { videoId: 'LXb3EKWsInQ' } };
        const command = { signInEndpoint: { nextEndpoint: watch } };

        resolve(command);
        assert.deepStrictEqual(command.signInEndpoint.nextEndpoint, watch);
    });
});

check('a command that is none of its business is left untouched', () => {
    withPage('FElibrary', () => {
        const command = { browseEndpoint: { browseId: 'FEsubscriptions' } };

        resolve(command);
        assert.deepStrictEqual(command, { browseEndpoint: { browseId: 'FEsubscriptions' } });
    });
});

check('Home leaves an account switch where YouTube would have put it', () => {
    withPage('', () => {
        const command = { onIdentityChanged: { identityActionContext: {} } };

        resolve(command);
        assert.deepStrictEqual(command.onIdentityChanged.identityActionContext, {});
    });
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
