// The page's request bodies take the set's zone from the service; a page without one is left alone.

global.window = {};

const { inZone } = await import('../../../mods/network/zone.js');

const results = [];

const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <- ${detail}`}`);
};

const body = { context: { client: { hl: 'de', utcOffsetMinutes: 0 } }, browseId: 'FEwhat_to_watch' };

check('without a zone the body goes as it was', inZone(body) === body, JSON.stringify(inZone(body)));

window.__TUBE_ZONE__ = { utcOffsetMinutes: 60, timeZone: 'Europe/Berlin' };

const placed = inZone(body);
check('the offset is the set\'s', placed.context.client.utcOffsetMinutes === 60, JSON.stringify(placed));
check('the zone is named', placed.context.client.timeZone === 'Europe/Berlin', JSON.stringify(placed));
check('the rest of the client is kept', placed.context.client.hl === 'de', JSON.stringify(placed));
check('the rest of the body is kept', placed.browseId === 'FEwhat_to_watch', JSON.stringify(placed));
check('the page\'s own object is not changed', body.context.client.utcOffsetMinutes === 0, JSON.stringify(body));

check('a body already in the zone is returned as it is', inZone(placed) === placed, '');
check('a body without a client is left alone', inZone({ context: {} }).context.client === undefined, '');

window.__TUBE_ZONE__ = { utcOffsetMinutes: 120, timeZone: null };
const unnamed = inZone(body);
check('a zone without a name still sets the offset',
    unnamed.context.client.utcOffsetMinutes === 120 && !('timeZone' in unnamed.context.client), JSON.stringify(unnamed));

process.exit(results.every(Boolean) ? 0 : 1);
