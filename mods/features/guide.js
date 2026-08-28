import { configRead, configChangeEmitter } from '../config.js';
import { onResponse } from '../youtube/json.js';
import { reloadGuide } from '../youtube/internals.js';

// The sidebar, trimmed. YouTube's guide arrives as sections of entries, each tagged
// with an icon type — WHAT_TO_WATCH for home, TAB_LIBRARY for library, and so on.
// Dropping an entry before the guide is drawn is the whole feature.

const GUIDE_KEYS = ['items'];

onResponse('guide', GUIDE_KEYS, (response) => {
    const sections = response.items;

    // A guide, and not merely something else that happens to have `items`.
    if (!Array.isArray(sections) || sections.length === 0) return;
    if (!sections[0] || !sections[0].guideSectionRenderer) return;

    const hidden = configRead('disabledSidebarContents') || [];
    const hideChannels = configRead('disableChannelsOnSidebar');

    if (hidden.length === 0 && !hideChannels) return;

    // Rebuilt rather than spliced while iterating: the original decremented its own
    // loop counter after each removal.
    const keep = (entry) => {
        const item = entry.guideEntryRenderer;
        if (!item) return true;

        const isHidden = item.icon && hidden.indexOf(item.icon.iconType) !== -1;
        const isChannel = hideChannels && !!item.thumbnail;

        return !isHidden && !isChannel;
    };

    sections.forEach((section) => {
        const renderer = section.guideSectionRenderer;
        if (renderer && Array.isArray(renderer.items)) {
            renderer.items = renderer.items.filter(keep);
        }
    });
});

// The guide is built once and cached, so a changed setting has no visible effect until
// YouTube is asked to build it again.
configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key === 'disabledSidebarContents' || event.detail.key === 'disableChannelsOnSidebar') {
        reloadGuide();
    }
});
