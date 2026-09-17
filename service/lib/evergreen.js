'use strict';

// Keeps our content copy able to run whichever Cobalt Evergreen installs, by adding each offered
// package's content files to it.

const fs = require('fs');
const path = require('path');

const postmortem = require('./postmortem.js');
const omaha = require('./omaha.js');
const { contentOf } = require('./crxContent.js');
const { merge } = require('./contentMerge.js');
const { sabiOf, versionOf } = require('./builtInCobalt.js');

const SHARE = process.env.TUBE_SHARE || '/home/owner/share/tube';
const STATE = path.join(SHARE, 'evergreen.json');

// Omaha offers by model year, which the set does not name, so every year since Evergreen began is asked.
const FIRST_YEAR = 2016;

const note = (what, detail) => postmortem.note('evergreen', `${what}: ${postmortem.describe(detail)}`);

const held = { content: null, queue: Promise.resolve(), mergedAt: 0 };

const merged = () => {
    try {
        return JSON.parse(fs.readFileSync(STATE, 'utf8')).merged || [];
    } catch (e) {
        return [];
    }
};

const remember = (name) => {
    fs.mkdirSync(SHARE, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify({ merged: merged().concat([name]) }));
};

// One job at a time, so two asks never fetch the same package.
const queued = (job) => {
    held.queue = held.queue.then(job).catch((error) => note('failed', error));
    return held.queue;
};

const fetchAny = (offer) => offer.urls.reduce(
    (tried, address) => tried.catch(() => contentOf(address, offer.sha256)),
    Promise.reject(new Error('no address offered'))
);

const listed = (names) => (names.length > 3 ? `${names.slice(0, 3).join(', ')}, …` : names.join(', '));

const take = (offer) => {
    if (!held.content || merged().indexOf(offer.name) !== -1) return Promise.resolve();

    return fetchAny(offer).then((files) => {
        const added = merge(held.content, files);
        if (added.length) held.mergedAt = Date.now();
        remember(offer.name);
        note('merged', `${offer.version}: ${added.length} of ${files.length} content files were new`
            + (added.length ? ` (${listed(added)})` : ''));
    });
};

const years = () => Array.from(
    { length: new Date().getFullYear() - FIRST_YEAR + 1 },
    (_, index) => FIRST_YEAR + index
);

// Every distinct package offered for any year.
const offersFor = (query) => years().reduce((done, year) => done.then((offers) => omaha.ask(Object.assign({ year }, query))
    .then((offer) => (offer && !offers.some((other) => other.name === offer.name) ? offers.concat([offer]) : offers))
    .catch((error) => {
        note('omaha', `${year}: ${postmortem.describe(error)}`);
        return offers;
    })), Promise.resolve([]));

const bootstrap = (content, stock) => {
    held.content = content;

    const query = { sabi: sabiOf(stock), version: versionOf(stock) };
    if (!query.sabi || !query.version) {
        note('waiting', 'the built-in library gives no SABI or version, so only Cobalt\'s own update checks are followed');
        return held.queue;
    }

    return queued(() => offersFor(query)
        .then((offers) => offers.reduce((done, offer) => done.then(() => take(offer)), Promise.resolve())));
};

const readOffer = (text) => {
    try {
        return omaha.offerOf(text);
    } catch (e) {
        return null;
    }
};

// Cobalt's own update check, as it passed through us.
const heardOffer = (text) => {
    const offer = readOffer(text);
    if (!offer) return held.queue;

    note('offered', `Cobalt was offered ${offer.version}`);
    return queued(() => take(offer));
};

// When the work in hand is done, and whether it added files after a moment.
const settled = () => held.queue;
const mergedSince = (since) => held.mergedAt >= since;

module.exports = { bootstrap, heardOffer, settled, mergedSince, FIRST_YEAR };
