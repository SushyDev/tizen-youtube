import { PASS, configRead, onCommand } from '../../framework/index.js';
import { indexOfSection, itemsOf, languageRow, languagesIn, opensCaptionMenu } from './captionMenu.js';
import { viewerLanguage } from './viewerLanguage.js';

const RECOMMENDED = 'Recommended languages';
const OTHER = 'Other languages';

// Among YouTube's own recommendations where there are any, so a language the viewer reads does not
// land at the bottom of eighty others.
const placeFor = (items) => {
    const recommended = indexOfSection(items, RECOMMENDED);
    if (recommended !== -1) return recommended + 1;

    const other = indexOfSection(items, OTHER);
    return other !== -1 ? other : 0;
};

// PASS throughout: the menu is dressed in place and YouTube's own resolver still opens it.
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
