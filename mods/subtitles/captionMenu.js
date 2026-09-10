// The captions menu, as the command that opens it carries it.
//
// One overlay, reached through eight names, dressed by two features — the viewer's own language,
// and every language the menu leaves out. Both need the same descent and the same row shape, so
// what that menu looks like is known here and the features only decide what to add.
//
// This waited on CLIENT_OVERLAY_TYPE_CAPTIONS_AUTO_TRANSLATE, which the container never sends:
// opening the menu on the set fires CAPTIONS_LANGUAGE, and the string AUTO_TRANSLATE appears
// nowhere in the app's own code, so the mod had been inert since the move into Cobalt. Both names
// are accepted, because a build still sending the old one costs nothing to keep working.

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

// Not the framework's overlayMessageRenderer: that one is a message with a title, and this is the
// divider between sections, which the app styles from the subtitle and an empty title.
const sectionTitle = (title) => ({
    overlayMessageRenderer: {
        title: { simpleText: '' },
        subtitle: { simpleText: title },
        style: 'OVERLAY_MESSAGE_STYLE_SUBSECTION_TITLE'
    }
});

export { opensCaptionMenu, itemsOf, languagesIn, indexOfSection, languageRow, sectionTitle };
