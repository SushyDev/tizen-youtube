// The settings response: where a category is in it, and what one looks like.

const runs = (text) => ({ runs: [{ text }] });

// The same text, read back. A title arrives as runs on one renderer and as simpleText on another,
// and a comparison against the wrong one silently never matches.
const textOf = (text) => {
    if (!text) return '';
    if (Array.isArray(text.runs)) return text.runs.map((run) => run.text).join('');
    return text.simpleText || '';
};

const categoryOf = (item) => item && item.settingCategoryCollectionRenderer;

// The end of the list when the category is not there, so an insertion point is always valid: a
// category we expected to sit before may simply not be on this build.
const indexOfCategory = (items, categoryId) => {
    const index = items.findIndex((item) => {
        const found = categoryOf(item);
        return found && found.categoryId === categoryId;
    });

    return index === -1 ? items.length : index;
};

const findCategory = (items, categoryId) => {
    const index = indexOfCategory(items, categoryId);
    return index === items.length ? null : categoryOf(items[index]);
};

const category = (categoryId, title, items) => ({
    settingCategoryCollectionRenderer: {
        categoryId,
        title: runs(title),
        focused: false,
        trackingParams: 'null',
        items
    }
});

export { runs, textOf, categoryOf, indexOfCategory, findCategory, category };
