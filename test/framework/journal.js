import assert from 'assert';

const listeners = {};
const sent = [];
const printed = [];

global.window = {
    localStorage: { 'tube.settings': '{}' },
    addEventListener: (type, handle) => { listeners[type] = handle; },
    _yttv: {}
};

global.document = { addEventListener: () => undefined, removeEventListener: () => undefined, querySelector: () => null };
global.location = { hash: '#/' };

global.window.Image = function Image() {
    Object.defineProperty(this, 'src', { set: (to) => sent.push(to) });
};

console.error = (...parts) => printed.push(parts.map(String).join(' '));
console.warn = (...parts) => printed.push(parts.map(String).join(' '));

const { report, warn } = await import('../../framework/registries/journal.js');
const { register, boot } = await import('../../framework/registries/register.js');
const { after } = await import('../../framework/registries/schedule.js');

const results = [];

const check = (name, run) => {
    try {
        run();
        results.push(true);
        process.stdout.write(`PASS  ${name}\n`);
    } catch (failure) {
        results.push(false);
        process.stdout.write(`FAIL  ${name}\n      ${String(failure.message).split('\n').slice(0, 5).join('\n      ')}\n`);
    }
};

const messages = () => sent.map((url) => decodeURIComponent(url.split('?m=')[1] || ''));
const sentHas = (fragment) => messages().some((message) => message.indexOf(fragment) !== -1);

check('a report goes to the service journal, relative to the page', () => {
    report('sponsorblock', 'failed', new TypeError('segments is undefined'));

    assert.ok(sent[0].indexOf('/__tube/journal?m=') === 0, sent[0]);
    assert.ok(sentHas('sponsorblock: failed - TypeError: segments is undefined'), messages().join(' | '));
});

check('and still to the console', () => {
    assert.ok(printed.some((line) => line.indexOf('[sponsorblock] failed') === 0), printed.join(' | '));
});

check('the same line is sent once', () => {
    const before = sent.length;
    const failure = new TypeError('once');

    report('tick', 'failed', failure);
    report('tick', 'failed', failure);

    assert.strictEqual(sent.length, before + 1);
});

check('a warning is sent too', () => {
    warn('json', 'late registered after interception began; it will not run');
    assert.ok(sentHas('json: late registered after interception began'));
});

check('boot says which userscript booted', () => {
    register('broken', 'ui', () => { throw new Error('no shelf'); });
    boot();

    assert.ok(sentHas('tube: userscript __TUBE_VERSION__-__TUBE_COMMIT__-__TUBE_TREE__ booted'), messages().join(' | '));
});

check('a feature that does not start is in the journal', () => {
    assert.ok(sentHas('broken: did not start - Error: no shelf'), messages().join(' | '));
});

check('and so is registering after boot', () => {
    register('tardy', 'ui', () => undefined);
    assert.ok(sentHas('register: tardy arrived after boot; it will not run'));
});

check('the page\'s own errors and rejections are sent', () => {
    listeners.error({ message: 'Uncaught ReferenceError: ytcfg is not defined', filename: 'https://www.youtube.com/tv', lineno: 12 });
    listeners.unhandledrejection({ reason: new Error('quota') });

    assert.ok(sentHas('error: Uncaught ReferenceError: ytcfg is not defined @ https://www.youtube.com/tv:12'));
    assert.ok(sentHas('rejection: Error: quota'));
});

await new Promise((done) => {
    after('failing', 0, () => { throw new Error('tick broke'); });
    setTimeout(done, 20);
});

check('a registry\'s failure is sent under its name', () => {
    assert.ok(sentHas('schedule:failing: failed - Error: tick broke'), messages().join(' | '));
});

check('a page can send only so much', () => {
    Array.from({ length: 300 }).forEach((_, at) => report('flood', `line ${at}`));
    assert.strictEqual(sent.length, 100);
});

process.stdout.write(`\n${results.filter(Boolean).length}/${results.length} checks passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
