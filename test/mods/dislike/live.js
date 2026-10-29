import assert from 'assert';

global.window = {
    localStorage: {
        'tube.settings': '{}',
        getItem: () => null,
        setItem: () => undefined
    },
    addEventListener: () => undefined
};
global.window.JSON = JSON;
global.location = { hash: '#/watch?v=liveDislikeA' };
global.document = { querySelectorAll: () => [] };

const { remember } = await import('../../../mods/dislike/store.js');
const { swapIfNeeded } = await import('../../../mods/dislike/live.js');

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

// Just what swapIfNeeded reads: text, attributes and the parent chain.
const element = (text, attributes, parent) => {
    const held = Object.assign({}, attributes);

    return {
        textContent: text,
        parentElement: parent || null,
        getAttribute: (name) => (Object.prototype.hasOwnProperty.call(held, name) ? held[name] : null),
        setAttribute: (name, value) => { held[name] = String(value); },
        removeAttribute: (name) => { delete held[name]; }
    };
};

remember('liveDislikeA', 79571);

check('the English label is swapped for the count', () => {
    const label = element('Dislike');
    swapIfNeeded(label);
    assert.strictEqual(label.textContent, '79K');
});

check('the German label is swapped as well', () => {
    const label = element('Mag ich nicht');
    swapIfNeeded(label);
    assert.strictEqual(label.textContent, '79K');
});

check('any label inside the dislike button is swapped, whatever its language', () => {
    const button = element('', { idomkey: 'dislike-button' });
    const label = element('Nie lubię', {}, element('', {}, button));
    swapIfNeeded(label);
    assert.strictEqual(label.textContent, '79K');
});

check('the like button keeps its own label', () => {
    const button = element('', { idomkey: 'like-button' });
    const label = element('Mag ich', {}, button);
    swapIfNeeded(label);
    assert.strictEqual(label.textContent, 'Mag ich');
});

check('the label it replaced comes back once no count is known', () => {
    const label = element('Mag ich nicht');
    swapIfNeeded(label);

    global.location.hash = '#/watch?v=liveDislikeUnknown';
    swapIfNeeded(label);
    global.location.hash = '#/watch?v=liveDislikeA';

    assert.strictEqual(label.textContent, 'Mag ich nicht');
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
