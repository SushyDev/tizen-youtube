import { PASS, configRead, onCommand } from '../../framework/index.js';

// The page the app opens on.
//
// The app decides this twice, in two unrelated ways, and both have to be answered or the setting
// only half holds.
//
// At launch, YouTube's TV app takes its opening page from the URL it was launched with. Everything
// after the `?` in the hash is parsed as launch parameters — the app writes its own route there as
// it goes, which is why the set reads `#/browse?c=FElibrary` while the library is on screen — and
// `c=<browseId>` is the parameter that says "open this browse page". kabuki reads them once,
// through a chain of resolvers it installs before our script runs, and the answer becomes the
// app's first navigation. So the setting is one launch parameter written into our own URL. There
// is no second page load, because there was never a first one to correct.
//
// After an account changes, nothing re-reads the URL — switching accounts is not a launch. kabuki
// resolves `nextEndpoint` once the account business is done, and every path that has no endpoint
// of its own carries the home one instead. So the setting is filled into that field, which is the
// same decision the launch parameter makes, at the only other moment it gets made.
//
// Three things follow from using the app's own two paths rather than reaching past them:
//
//   a real deep link still wins   a launched video arrives as parameters in the same URL, and the
//                                 resolvers that read those run ahead of the one that reads `c`.
//   the account picker is free    every screen that stands in the way at startup carries the
//                                 resolved launch command as the place to go once it is done, so
//                                 the chosen page survives the picker at boot without this having
//                                 to know the picker exists.
//   nothing is named              no obfuscated module, no marker in a minified source, in either
//                                 half. Both are part of how the app talks to itself.
//
// What this replaces waited for the welcome screen to disappear and then resolved a browse
// command, which is why choosing a start page cost a visible second load: home was fetched, drawn,
// and thrown away. Swapping kabuki's own home endpoint in its module registry was tried before
// this and cannot work from here at all — the container loads that code in chunks after our
// script, so at boot there is nothing yet to replace.

// The route kabuki writes for a browse page, which is the shape its resolvers read back. Only what
// follows the `?` is parsed, so the path is there to be recognisable rather than to be read.
const ROUTE = '/browse?c=';

// The browseIds kabuki's own route writer treats as home — it omits `c` entirely for both. They
// are what an unfilled nextEndpoint amounts to, and what an unset setting leaves alone.
const HOME = ['default', 'FEtopics'];

// The commands that end with "and then go here". Named rather than matched by shape, because a
// rule that filled in a missing nextEndpoint wherever it found one would write the field into
// browse and search endpoints too.
const AFTER_AN_ACCOUNT = [
    'onIdentityChanged',
    'reloadOnAccountSwitch',
    'startAccountSelectorCommand',
    'requestAccountSelectorCommand',
    'startSignInCommand',
    'switchToGuestMode',
    'signInEndpoint'
];

const endpointFor = (page) => ({ browseEndpoint: { browseId: page } });

const isHome = (endpoint) => !!endpoint
    && !!endpoint.browseEndpoint
    && !endpoint.browseEndpoint.params
    && HOME.indexOf(endpoint.browseEndpoint.browseId) !== -1;

// Absent means home to all of these — each reads the field as `nextEndpoint || <home>` — so an
// absent one and a home one are the same answer, and both are ours to replace.
const sendTo = (holder, endpoint) => {
    if (!holder || typeof holder !== 'object') return;
    if (holder.nextEndpoint !== undefined && !isHome(holder.nextEndpoint)) return;

    holder.nextEndpoint = endpoint;
};

// Dressed in place, as every other mod dresses what YouTube hands it: the app already holds this
// object, and the command is the interface.
const dress = (command, endpoint) => AFTER_AN_ACCOUNT.forEach((name) => {
    const inner = command[name];
    if (!inner || typeof inner !== 'object') return;

    sendTo(inner, endpoint);
    sendTo(inner.identityActionContext, endpoint);
});

// Read when the command is answered rather than closed over at boot. The launch half cannot take
// effect until the app is started again — it is a launch parameter — but this half can, and there
// is no reason to make it wait.
const afterAnAccount = (command) => {
    const page = configRead('startupPage');
    if (page) dress(command, endpointFor(page));

    return PASS;
};

const start = () => {
    const page = configRead('startupPage');
    if (!page) return;

    // Assigned, and wrapped, exactly as kabuki assigns it. The container has no History API at all
    // — window.history is there but carries no replaceState — and a Location that refuses the
    // write is the reason kabuki's own assignment sits in a try/catch too.
    try {
        window.location.hash = `${ROUTE}${encodeURIComponent(page)}`;
    } catch (e) {
        console.warn('[start page] the container would not take a launch parameter.', e);
    }

    // It answers PASS always: this adds a field and then lets YouTube answer its own command.
    // Claiming it would take the account work with it.
    onCommand('start page', afterAnAccount);
};

export { start };
