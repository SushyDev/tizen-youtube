import { configChangeEmitter, configRead, onResponse, reloadGuide } from '../../framework/index.js';

const GUIDE_KEYS = ['items'];

// Settings comes in the guide's footer, which kabuki draws 2rem below the last entry; with sections
// hidden that reads as an entry gone missing. Joined to the last section it sits in line.
const joinFooter = (response, sections) => {
    const footer = response.footer && response.footer.guideSectionRenderer;
    const last = sections[sections.length - 1].guideSectionRenderer;
    if (!footer || !Array.isArray(footer.items) || !last || !Array.isArray(last.items)) return;

    last.items = last.items.concat(footer.items);
    delete response.footer;
};

onResponse('guide', GUIDE_KEYS, (response) => {
    const sections = response.items;

    if (!Array.isArray(sections) || sections.length === 0) return;
    if (!sections[0] || !sections[0].guideSectionRenderer) return;

    joinFooter(response, sections);

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
