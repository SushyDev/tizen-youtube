import assert from 'assert';
import { check, finish } from '../harness.js';

const { GROUPS } = await import('../../mods/settings/settingsModel.js');
const { ADDED } = await import('../../mods/settings/adoptedRows.js');
const { SEGMENTS } = await import('../../mods/sponsorblock/segments.js');
const { say, TABLES } = await import('../../mods/i18n/index.js');

const speaking = (hl, run) => {
    window.ytcfg = { get: (key) => (key === 'INNERTUBE_CONTEXT' ? { client: { hl } } : undefined) };
    try {
        return run();
    } finally {
        delete window.ytcfg;
    }
};

// Numbers, codecs and resolutions read the same in every language.
const WORDLESS = /^[\d.,%×p]+$|^(VP9|AV1|H\.264)$/;

const shownInSettings = () => GROUPS.reduce((all, group) => all.concat([group.title], group.items.reduce(
    (inner, item) => inner.concat([item.title, item.summary, item.prefix].filter(Boolean),
        (item.options || []).map((option) => option.label)), [])), [])
    .concat(ADDED.map((entry) => entry.title))
    .concat(Object.keys(SEGMENTS).map((key) => SEGMENTS[key].name))
    .filter((text) => !WORDLESS.test(text));

Object.keys(TABLES).forEach((language) => {
    check(`every phrase the settings show has a ${language} translation`, () => {
        const missing = shownInSettings().filter((text) => !Object.prototype.hasOwnProperty.call(TABLES[language], text));
        assert.deepStrictEqual(missing.filter((text, at) => missing.indexOf(text) === at), []);
    });

    check(`every ${language} translation keeps its placeholders`, () => {
        const broken = Object.keys(TABLES[language]).filter((text) => {
            const wanted = (text.match(/\{\d+\}/g) || []).sort().join();
            return (TABLES[language][text].match(/\{\d+\}/g) || []).sort().join() !== wanted;
        });
        assert.deepStrictEqual(broken, []);
    });
});

check('the page\'s own language is used', () =>
    speaking('de', () => assert.strictEqual(say('Remember playback speed'), 'Wiedergabegeschwindigkeit merken')));

check('a regional language uses its base table', () =>
    speaking('de-AT', () => assert.strictEqual(say('Library'), 'Mediathek')));

check('every table carries the same phrases as the German one', () => {
    const wanted = Object.keys(TABLES.de).sort();
    Object.keys(TABLES).forEach((language) => assert.deepStrictEqual(Object.keys(TABLES[language]).sort(), wanted, language));
});

check('YouTube\'s regional codes find their table', () => {
    assert.strictEqual(speaking('zh-CN', () => say('Library')), '媒体库');
    assert.strictEqual(speaking('es-419', () => say('Library')), 'Biblioteca');
    assert.strictEqual(speaking('pt-PT', () => say('Library')), 'Biblioteca');
});

check('a language without a table stays in English', () =>
    speaking('fi', () => assert.strictEqual(say('Library'), 'Library')));

check('a phrase without a translation stays as written', () =>
    speaking('de', () => assert.strictEqual(say('Nothing like this exists'), 'Nothing like this exists')));

check('placeholders are filled in either language', () => {
    assert.strictEqual(speaking('en', () => say('Skip {0}', ['intro'])), 'Skip intro');
    assert.strictEqual(speaking('de', () => say('Not skipping {0} (was skipped {1} times)', ['Intro', 3])),
        'Intro wird nicht übersprungen (schon 3-mal übersprungen)');
});

check('without a page config the cookie names the language', () => {
    global.document = { cookie: 'VISITOR=1; PREF=f6=40000000&hl=de&tz=Europe.Berlin' };
    try {
        assert.strictEqual(say('Library'), 'Mediathek');
    } finally {
        delete global.document;
    }
});

finish();
