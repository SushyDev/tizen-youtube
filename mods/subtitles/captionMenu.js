// The captions menu's shape, shared by the features that add rows to it.

// The container sends CAPTIONS_LANGUAGE; AUTO_TRANSLATE is kept for older builds.
const CAPTION_MENUS = [
    'CLIENT_OVERLAY_TYPE_CAPTIONS_LANGUAGE',
    'CLIENT_OVERLAY_TYPE_CAPTIONS_AUTO_TRANSLATE'
];

const opensCaptionMenu = (cmd) => CAPTION_MENUS.indexOf(cmd?.openPopupAction?.uniqueId) !== -1;

// Null rather than an empty array when the shape is not what is expected: a caller that pushes
// into nothing should stop, not silently succeed.
const itemsOf = (cmd) => cmd?.openPopupAction?.popup?.overlaySectionRenderer?.overlay
    ?.overlayTwoPanelRenderer?.actionPanel?.overlayPanelRenderer?.content
    ?.overlayPanelItemListRenderer?.items || null;

const trackOf = (item) => {
    const commands = item?.compactLinkRenderer?.serviceEndpoint?.commandExecutorCommand?.commands;
    return commands?.[0]?.selectSubtitlesTrackCommand?.translationLanguage || null;
};

// A track is identified by its code in one place and by its name in another, so both count as
// already offered — matching on only one of them lists half the menu twice.
const languagesIn = (items) => new Set(items
    .map(trackOf)
    .filter(Boolean)
    .reduce((all, track) => all.concat([track.languageCode, track.languageName]), []));

const sectionTitleOf = (item) => item?.overlayMessageRenderer?.subtitle?.simpleText || null;

const indexOfSection = (items, title) => items.findIndex((item) => sectionTitleOf(item) === title);

// The three commands YouTube's own rows carry, in the order it sends them: pick the track, redraw
// the menu against the new selection, then close it.
const languageRow = (languageCode, languageName) => ({
    compactLinkRenderer: {
        title: { simpleText: languageName },
        serviceEndpoint: {
            commandExecutorCommand: {
                commands: [
                    { selectSubtitlesTrackCommand: { translationLanguage: { languageCode, languageName } } },
                    { openClientOverlayAction: { type: CAPTION_MENUS[0], updateAction: true } },
                    { signalAction: { signal: 'POPUP_BACK' } }
                ]
            }
        },
        secondaryIcon: { iconType: 'RADIO_BUTTON_UNCHECKED' }
    }
});

// The divider between sections, which the app styles from the subtitle under an empty title.
const sectionTitle = (title) => ({
    overlayMessageRenderer: {
        title: { simpleText: '' },
        subtitle: { simpleText: title },
        style: 'OVERLAY_MESSAGE_STYLE_SUBSECTION_TITLE'
    }
});

export { opensCaptionMenu, itemsOf, languagesIn, indexOfSection, languageRow, sectionTitle };
