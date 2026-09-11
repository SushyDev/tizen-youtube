import { PASS, configRead, onCommand } from '../../framework/index.js';
import { itemsOf, languageRow, languagesIn, opensCaptionMenu, sectionTitle } from './captionMenu.js';
import { allLanguages } from './languageCatalogue.js';

// Every language YouTube can translate a caption track into but did not offer, appended as its
// own section.

const SECTION = 'Other Languages';

onCommand('other subtitle languages', (cmd) => {
    if (!configRead('enableShowOtherLanguages')) return PASS;
    if (!opensCaptionMenu(cmd)) return PASS;

    const items = itemsOf(cmd);
    if (!items) return PASS;

    const listed = languagesIn(items);
    const missing = allLanguages()
        .filter((language) => !listed.has(language.code) && !listed.has(language.name));

    if (!missing.length) return PASS;

    items.push(sectionTitle(SECTION));
    missing.forEach((language) => items.push(languageRow(language.code, language.name)));

    return PASS;
});
