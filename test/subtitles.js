// The captions menu.
//
// What this replaced was one 306-line file holding a language catalogue, a country-to-language
// guess, the row shapes and two independent features, wired through a hook that had been inert
// since the move into Cobalt because it waited on an overlay name the container never sends. The
// point of these checks is that each of those is now separately answerable.
//
// The interpreters are driven through the real command bus rather than called directly: the bus is
// where the two features meet, and the order they meet in is what stops a language being offered
// twice.

import assert from 'assert';

global.window = {
    localStorage: { 'tube.settings': '{}' },
    addEventListener: () => undefined,
    yt: { config_: { GL: 'FR' } },
    _yttv: {}
};
global.window.JSON = JSON;
global.fetch = () => new Promise(() => { });

const { configRead, configWrite } = await import('../framework/config.js');
const { claimCommands } = await import('../framework/commands.js');
const { languagesIn, itemsOf, opensCaptionMenu } = await import('../mods/subtitles/captionMenu.js');
const { allLanguages } = await import('../mods/subtitles/languageCatalogue.js');
const { viewerLanguage } = await import('../mods/subtitles/viewerLanguage.js');
await import('../mods/subtitles/index.js');

// The registry shape internals.js looks through, holding one thing that resolves commands.
const untouched = (command) => command;
global.window._yttv.router = { instance: { resolveCommand: untouched } };
assert.ok(claimCommands(), 'the command bus never found a resolver to patch');

const resolveCommand = (command) => window._yttv.router.instance.resolveCommand(command);

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

const withConfig = (settings, run) => {
    const before = Object.keys(settings).map((key) => [key, configRead(key)]);
    Object.keys(settings).forEach((key) => configWrite(key, settings[key]));
    try {
        run();
    } finally {
        before.forEach((entry) => configWrite(entry[0], entry[1]));
    }
};

const track = (languageCode, languageName) => ({
    compactLinkRenderer: {
        title: { simpleText: languageName },
        serviceEndpoint: {
            commandExecutorCommand: {
                commands: [{
                    selectSubtitlesTrackCommand: { translationLanguage: { languageCode, languageName } }
                }]
            }
        }
    }
});

const heading = (title) => ({
    overlayMessageRenderer: {
        title: { simpleText: '' },
        subtitle: { simpleText: title },
        style: 'OVERLAY_MESSAGE_STYLE_SUBSECTION_TITLE'
    }
});

// The shape the set sends, read off it: a titled section of recommendations, then the tracks.
const menu = (items) => ({
    openPopupAction: {
        uniqueId: 'CLIENT_OVERLAY_TYPE_CAPTIONS_LANGUAGE',
        popup: {
            overlaySectionRenderer: {
                overlay: {
                    overlayTwoPanelRenderer: {
                        actionPanel: {
                            overlayPanelRenderer: {
                                content: { overlayPanelItemListRenderer: { items } }
                            }
                        }
                    }
                }
            }
        }
    }
});

const opened = (items) => itemsOf(resolveCommand(menu(items)));

const titlesIn = (items) => items
    .filter((item) => item.overlayMessageRenderer)
    .map((item) => item.overlayMessageRenderer.subtitle.simpleText);

const namesIn = (items) => items
    .filter((item) => item.compactLinkRenderer)
    .map((item) => item.compactLinkRenderer.title.simpleText);

const BOTH_OFF = { enableShowUserLanguage: false, enableShowOtherLanguages: false };
const OWN_ONLY = { enableShowUserLanguage: true, enableShowOtherLanguages: false };
const OTHER_ONLY = { enableShowUserLanguage: false, enableShowOtherLanguages: true };
const BOTH_ON = { enableShowUserLanguage: true, enableShowOtherLanguages: true };

check('the account country decides the language offered', () => {
    assert.deepStrictEqual(viewerLanguage(), { code: 'fr', name: 'French' });
});

// The hook this replaced waited on CAPTIONS_AUTO_TRANSLATE, which the container never sends, so
// the whole mod was inert on the set. CAPTIONS_LANGUAGE is what opening the menu actually fires.
check('the overlay the container actually sends is the one recognised', () => {
    assert.strictEqual(opensCaptionMenu({ openPopupAction: { uniqueId: 'CLIENT_OVERLAY_TYPE_CAPTIONS_LANGUAGE' } }), true);
    assert.strictEqual(opensCaptionMenu({ openPopupAction: { uniqueId: 'CLIENT_OVERLAY_TYPE_CAPTIONS_AUTO_TRANSLATE' } }), true);
    assert.strictEqual(opensCaptionMenu({ openPopupAction: { uniqueId: 'SOMETHING_ELSE' } }), false);
    assert.strictEqual(opensCaptionMenu(undefined), false);
});

check('a track counts as offered under its code and under its name', () => {
    const listed = languagesIn([track('de', 'German')]);
    assert.ok(listed.has('de') && listed.has('German'));
});

check('with both switches off the menu is left exactly as it came', () => {
    withConfig(BOTH_OFF, () => {
        assert.deepStrictEqual(namesIn(opened([heading('Recommended languages'), track('de', 'German')])),
            ['German']);
    });
});

check("the viewer's own language goes in under the recommendations", () => {
    withConfig(OWN_ONLY, () => {
        assert.deepStrictEqual(namesIn(opened([heading('Recommended languages'), track('de', 'German')])),
            ['French', 'German']);
    });
});

check('and is not offered twice when it is already there', () => {
    withConfig(OWN_ONLY, () => {
        assert.deepStrictEqual(namesIn(opened([heading('Recommended languages'), track('fr', 'French')])),
            ['French']);
    });
});

check('with no recommendations to sit under, it goes above everything else', () => {
    withConfig(OWN_ONLY, () => {
        assert.deepStrictEqual(namesIn(opened([track('de', 'German')])), ['French', 'German']);
    });
});

check('every language the menu left out is appended under its own title', () => {
    withConfig(OTHER_ONLY, () => {
        const items = opened([track('de', 'German')]);
        assert.deepStrictEqual(titlesIn(items), ['Other Languages']);
        assert.strictEqual(namesIn(items).length, allLanguages().length,
            'German was listed already, so exactly one of the catalogue should have been skipped');
        assert.strictEqual(namesIn(items).filter((name) => name === 'German').length, 1);
    });
});

check("with both on, the viewer's language is placed once and not repeated below", () => {
    withConfig(BOTH_ON, () => {
        const names = namesIn(opened([heading('Recommended languages'), track('de', 'German')]));
        assert.strictEqual(names.filter((name) => name === 'French').length, 1,
            'the other-languages section offered a language that had just been added above it');
        assert.strictEqual(names[0], 'French');
    });
});

check('a menu whose shape is not what was expected is declined, not thrown on', () => {
    withConfig(BOTH_ON, () => {
        const bare = { openPopupAction: { uniqueId: 'CLIENT_OVERLAY_TYPE_CAPTIONS_LANGUAGE', popup: {} } };
        assert.deepStrictEqual(resolveCommand(bare), bare);
    });
});

check('the catalogue is alphabetical by the name that will be shown', () => {
    const names = allLanguages().map((language) => language.name);
    assert.deepStrictEqual(names, names.slice().sort((a, b) => a.localeCompare(b)));
});

const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
