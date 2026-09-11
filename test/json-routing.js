// Key routing in the JSON bus.
//
// Every handler's keys used to be merged into one set, and a root carrying any key in that union
// ran every handler. adblock.js alone declared thirteen keys including `contents`, `items` and
// `entries`, so the gate stood open for most objects and the quality settler restarted its burst
// on every browse response. These checks are what "the keys are a dispatch index" has to mean.
//
// In its own file because it takes over the process's JSON.parse and JSON.stringify.

import assert from 'assert';

global.window = { localStorage: { 'tube.settings': '{}' }, addEventListener: () => undefined };
global.window.JSON = JSON;

const { onResponse, onRequest, interceptJson, clone } = await import('../framework/json.js');

const seen = [];

onResponse('streaming only', ['streamingData'], () => seen.push('streaming'));
onResponse('guide only', ['items'], () => seen.push('guide'));
onResponse('either', ['contents', 'items'], () => seen.push('either'));

onRequest('playback', ['playbackContext'], (value) => Object.assign({}, value, { dressed: true }));
onRequest('untouched', ['nothingLikeThis'], (value) => Object.assign({}, value, { wrong: true }));

interceptJson();

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        console.log(`PASS  ${name}`);
    } catch (failure) {
        results.push(false);
        console.log(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}`);
    }
};

const parsed = (value) => {
    seen.length = 0;
    JSON.parse(JSON.stringify.call(null, value));
    return seen.slice();
};

check('a response reaches only the handlers whose keys it carries', () => {
    assert.deepStrictEqual(parsed({ streamingData: {} }), ['streaming']);
});

check('a key two handlers asked for reaches both, in registration order', () => {
    assert.deepStrictEqual(parsed({ items: [] }), ['guide', 'either']);
});

check('a handler wanting two keys is told once for a root carrying both', () => {
    assert.deepStrictEqual(parsed({ contents: {}, items: [] }), ['guide', 'either']);
});

check('a response carrying nothing anyone asked for reaches nobody', () => {
    assert.deepStrictEqual(parsed({ somethingElse: 1 }), []);
});

check('an array is not a response', () => {
    assert.deepStrictEqual(parsed([{ items: [] }]), []);
});

check('a writer only rewrites a body carrying its key', () => {
    const dressed = JSON.parse(JSON.stringify({ playbackContext: {} }));
    assert.strictEqual(dressed.dressed, true);
    assert.strictEqual(dressed.wrong, undefined, 'a writer ran for a key it never asked about');

    const left = JSON.parse(JSON.stringify({ somethingElse: 1 }));
    assert.strictEqual(left.dressed, undefined);
});

check('parse still returns what it was given', () => {
    assert.deepStrictEqual(JSON.parse('{"streamingData":{"a":1}}'), { streamingData: { a: 1 } });
    assert.strictEqual(JSON.parse('3'), 3);
    assert.strictEqual(JSON.parse('null'), null);
});

check('interceptJson is idempotent', () => {
    const before = JSON.parse;
    interceptJson();
    assert.strictEqual(JSON.parse, before, 'a second call wrapped the wrapper');
});

check('a reader that clones its response is not re-entered', () => {
    const runs = { n: 0 };

    onResponse('cloner', ['clonable'], (r) => {
        runs.n += 1;
        if (runs.n > 20) throw new Error('runaway');
        clone(r);
    });

    runs.n = 0;
    JSON.parse('{"clonable":{"a":1}}');

    assert.strictEqual(runs.n, 1, `the reader ran ${runs.n} times; cloning re-entered the hook`);
});

check('clone still copies deeply', () => {
    const source = { clonable: { deep: { list: [1, 2, 3] } } };
    const copy = clone(source);

    assert.deepStrictEqual(copy, source);
    copy.clonable.deep.list.push(4);
    assert.strictEqual(source.clonable.deep.list.length, 3, 'clone shares structure with its source');
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
