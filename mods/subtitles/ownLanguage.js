import { PASS, configRead, onCommand } from '../../framework/index.js';
import { indexOfSection, itemsOf, languageRow, languagesIn, opensCaptionMenu } from './captionMenu.js';
import { viewerLanguage } from './viewerLanguage.js';

// The viewer's own language, put into the captions menu when YouTube leaves it out.

const RECOMMENDED = 'Recommended languages';
const OTHER = 'Other languages';

// Under YouTube's own recommendations where there are any, above everything else where there are
// not: a language the viewer actually reads belongs among the recommendations, not at the bottom
// of eighty others.
const placeFor = (items) => {
    const recommended = indexOfSection(items, RECOMMENDED);
    if (recommended !== -1) return recommended + 1;

    const other = indexOfSection(items, OTHER);
    return other !== -1 ? other : 0;
};

// PASS throughout: this dresses the menu in place and then declines to answer the command, which
// is what leaves YouTube's own resolver to open it.
onCommand('own subtitle language', (cmd) => {
    if (!configRead('enableShowUserLanguage')) return PASS;
    if (!opensCaptionMenu(cmd)) return PASS;

    const items = itemsOf(cmd);
    if (!items) return PASS;

    const own = viewerLanguage();
    if (!own) return PASS;

    const listed = languagesIn(items);
    if (listed.has(own.code) || listed.has(own.name)) return PASS;

    items.splice(placeFor(items), 0, languageRow(own.code, own.name));

    return PASS;
});
