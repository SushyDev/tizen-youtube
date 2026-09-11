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

check('a chosen page becomes the launch parameter that opens it', () => {
    withPage('FEsubscriptions', (hashes) => {
        assert.deepStrictEqual(hashes, ['/browse?c=FEsubscriptions']);
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
