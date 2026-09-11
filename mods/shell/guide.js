import { configChangeEmitter, configRead, onResponse, reloadGuide } from '../../framework/index.js';

const GUIDE_KEYS = ['items'];

onResponse('guide', GUIDE_KEYS, (response) => {
    const sections = response.items;

    if (!Array.isArray(sections) || sections.length === 0) return;
    if (!sections[0] || !sections[0].guideSectionRenderer) return;

    const hidden = configRead('disabledSidebarContents') || [];
    if (hidden.length === 0) return;

    const keep = (entry) => {
        const item = entry.guideEntryRenderer;
        if (!item) return true;

        return !(item.icon && hidden.indexOf(item.icon.iconType) !== -1);
    };

    sections.forEach((section) => {
        const renderer = section.guideSectionRenderer;
        if (renderer && Array.isArray(renderer.items)) {
            renderer.items = renderer.items.filter(keep);
        }
    });
});

configChangeEmitter.addEventListener('configChange', (event) => {
    if (event.detail.key === 'disabledSidebarContents') reloadGuide();
});
