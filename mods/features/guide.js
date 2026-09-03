import { configRead, configChangeEmitter } from '../config.js';
import { onResponse } from '../youtube/json.js';
import { reloadGuide } from '../youtube/internals.js';

const GUIDE_KEYS = ['items'];

onResponse('guide', GUIDE_KEYS, (response) => {
    const sections = response.items;

    if (!Array.isArray(sections) || sections.length === 0) return;
    if (!sections[0] || !sections[0].guideSectionRenderer) return;

    const hidden = configRead('disabledSidebarContents') || [];
    const hideChannels = configRead('disableChannelsOnSidebar');

    if (hidden.length === 0 && !hideChannels) return;

    // Rebuilt rather than spliced while iterating: the original decremented its own loop
    // counter after each removal.
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

// The guide is built once and cached, so a changed setting shows nothing until YouTube
// is asked to build it again.
configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key === 'disabledSidebarContents' || event.detail.key === 'disableChannelsOnSidebar') {
        reloadGuide();
    }
});
