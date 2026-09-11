import { PASS, configRead, onCommand } from '../../framework/index.js';

// Opens the chosen browse page by writing kabuki's `c` launch parameter, and fills it into
// account-switch commands whose nextEndpoint is absent or home.

// kabuki parses only what follows the `?`; the path mirrors the route it writes for itself.
const ROUTE = '/browse?c=';

// kabuki's route writer omits `c` for these browseIds, so a nextEndpoint naming one means home.
const HOME = ['default', 'FEtopics'];

// Commands that read nextEndpoint as the place to go after an account change.
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

const dress = (command, endpoint) => AFTER_AN_ACCOUNT.forEach((name) => {
    const inner = command[name];
    if (!inner || typeof inner !== 'object') return;

    sendTo(inner, endpoint);
    sendTo(inner.identityActionContext, endpoint);
});

const afterAnAccount = (command) => {
    const page = configRead('startupPage');
    if (page) dress(command, endpointFor(page));

    return PASS;
};

const start = () => {
    onCommand('start page', afterAnAccount);

    const page = configRead('startupPage');
    if (!page) return;

    // Cobalt's history has no replaceState, and its Location can refuse the write.
    try {
        window.location.hash = `${ROUTE}${encodeURIComponent(page)}`;
    } catch (e) {
        console.warn('[start page] the container would not take a launch parameter.', e);
    }
};

export { start };
