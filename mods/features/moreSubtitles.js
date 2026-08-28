// Adds the subtitle languages YouTube leaves out of the TV auto-translate menu,
// including the user's own.

import { configRead } from "../config.js";
import { displayLanguage, displayRegion } from "../languageNames.js";

const LANGUAGE_CODES = [
    "af", "sq", "am", "ar", "hy", "as", "az", "eu", "be", "bn", "bs", "bg",
    "my", "ca", "zh-CN", "zh-TW", "zh-HK", "hr", "cs", "da", "nl", "en", "et",
    "fil", "fi", "fr", "gl", "ka", "de", "el", "gu", "he", "hi", "hu", "is",
    "id", "ga", "it", "ja", "kn", "kk", "km", "ko", "ky", "lo", "lv", "lt",
    "mk", "ms", "ml", "mt", "mr", "mn", "ne", "no", "or", "fa", "pl", "pt",
    "pa", "ro", "ru", "sr", "si", "sk", "sl", "es", "sw", "sv", "ta", "te",
    "th", "tr", "uk", "ur", "uz", "vi", "cy", "yi", "yo", "zu"
];

export function getComprehensiveLanguageList() {
    try {
        const map = {};
        LANGUAGE_CODES.forEach((code) => {
            if (code.includes("-")) {
                const [lang, region] = code.split("-");
                const languageName = displayLanguage(lang);
                const regionName = displayRegion(region);
                map[code] = `${languageName} (${regionName})`;
            } else {
                const name = displayLanguage(code);
                map[code] = name;
            }
        });
        return map;
    } catch (e) {
        const fallback = {};
        LANGUAGE_CODES.forEach((c) => (fallback[c] = c));
        return fallback;
    }
}

// Infers the likely language for an ISO 3166-1 alpha-2 country code, or null.
export function getCountryLanguage(countryCode) {
    if (!countryCode) return null;
    try {
        const region = String(countryCode).toUpperCase();

        const zhRegionMap = { CN: "zh-CN", TW: "zh-TW", HK: "zh-HK", SG: "zh-CN" };
        if (zhRegionMap[region]) {
            const code = zhRegionMap[region];
            const name = displayLanguage(code);
            return { code, name };
        }

        const base = new Intl.Locale("und", { region });
        const maximized = base.maximize ? base.maximize() : base;
        const lang = maximized.language || "en";

        const name = displayLanguage(lang);

        return { code: lang, name };
    } catch (e) {
        console.warn("Subtitles: Could not infer language for country", countryCode, e);
        return null;
    }
}

let isPatched = false;

function getUserCountryCode() {
    try {
        if (window.yt && window.yt.config_ && window.yt.config_.GL) {
            return window.yt.config_.GL;
        }

        console.warn(
            "Subtitles: Could not determine user country code"
        );
        return null;
    } catch (error) {
        console.error(
            "Subtitles: Error getting country code:",
            error
        );
        return null;
    }
}

function languageExistsInMenu(items, languageCode, languageName) {
    return items.some((item) => {
        if (
            item.compactLinkRenderer &&
            item.compactLinkRenderer.serviceEndpoint
        ) {
            const commands =
                item.compactLinkRenderer.serviceEndpoint.commandExecutorCommand
                    ?.commands;
            if (
                commands &&
                commands[0] &&
                commands[0].selectSubtitlesTrackCommand
            ) {
                const translationLang =
                    commands[0].selectSubtitlesTrackCommand.translationLanguage;
                return (
                    translationLang &&
                    (translationLang.languageCode === languageCode ||
                        translationLang.languageName === languageName)
                );
            }
        }
        return false;
    });
}

function createLanguageOption(languageCode, languageName) {
    return {
        compactLinkRenderer: {
            title: { simpleText: languageName },
            serviceEndpoint: {
                commandExecutorCommand: {
                    commands: [
                        {
                            selectSubtitlesTrackCommand: {
                                translationLanguage: {
                                    languageCode,
                                    languageName,
                                },
                            },
                        },
                        {
                            openClientOverlayAction: {
                                type: "CLIENT_OVERLAY_TYPE_CAPTIONS_LANGUAGE",
                                updateAction: true,
                            },
                        },
                        {
                            signalAction: { signal: "POPUP_BACK" },
                        },
                    ],
                },
            },
            secondaryIcon: { iconType: "RADIO_BUTTON_UNCHECKED" },
        },
    };
}

function getExistingLanguages(items) {
    const existingLanguages = new Set();

    items.forEach((item) => {
        if (
            item.compactLinkRenderer &&
            item.compactLinkRenderer.serviceEndpoint
        ) {
            const commands =
                item.compactLinkRenderer.serviceEndpoint.commandExecutorCommand
                    ?.commands;
            if (
                commands &&
                commands[0] &&
                commands[0].selectSubtitlesTrackCommand
            ) {
                const translationLang =
                    commands[0].selectSubtitlesTrackCommand.translationLanguage;
                if (translationLang) {
                    existingLanguages.add(translationLang.languageCode);
                    existingLanguages.add(translationLang.languageName);
                }
            }
        }
    });

    return existingLanguages;
}

function createSectionTitle(title) {
    return {
        overlayMessageRenderer: {
            title: { simpleText: "" },
            subtitle: { simpleText: title },
            style: "OVERLAY_MESSAGE_STYLE_SUBSECTION_TITLE",
        },
    };
}

function patchSubtitleMenu() {
    if (isPatched) return;

    const player = document.querySelector('.html5-video-player');
    if (!player) return setTimeout(patchSubtitleMenu, 250);

    // Settings are read when the menu opens, not here.
    if (!window._yttv) return setTimeout(patchSubtitleMenu, 250);
    const yttvInstance = Object.values(window._yttv).find(
        (obj) =>
            obj &&
            obj.instance &&
            typeof obj.instance.resolveCommand === "function"
    );

    if (
        !yttvInstance ||
        yttvInstance.instance.resolveCommand.isPatchedBySubtitleLocalization
    ) {
        if (!yttvInstance) {
            console.error(
                "Subtitles: Could not find resolveCommand instance."
            );
        } else {
            console.log("Subtitles: Already patched.");
        }
        return;
    }

    const originalResolveCommand = yttvInstance.instance.resolveCommand;

    yttvInstance.instance.resolveCommand = function (cmd, _) {
        if (
            cmd?.openPopupAction?.uniqueId ===
            "CLIENT_OVERLAY_TYPE_CAPTIONS_AUTO_TRANSLATE"
        ) {
            const showUserLanguage = configRead("enableShowUserLanguage");
            const showOtherLanguages = configRead("enableShowOtherLanguages");

            if (!showUserLanguage && !showOtherLanguages) {
                return originalResolveCommand.apply(this, arguments);
            }

            const items =
                cmd.openPopupAction.popup.overlaySectionRenderer.overlay
                    .overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer
                    .content.overlayPanelItemListRenderer.items;

            const existingLanguages = getExistingLanguages(items);

            if (showUserLanguage) {
                const userCountryCode = getUserCountryCode();
                const userLanguage = getCountryLanguage(userCountryCode);

                if (userLanguage) {
                    if (
                        !languageExistsInMenu(items, userLanguage.code, userLanguage.name)
                    ) {
                        console.log(
                            `%c[subtitles] Adding user's local language: ${userLanguage.name} (${userLanguage.code})`,
                            "background: #2196F3; color: #ffffff; font-size: 14px; font-weight: bold;"
                        );

                        const userLanguageOption = createLanguageOption(
                            userLanguage.code,
                            userLanguage.name
                        );

                        // Find the "Recommended languages" section and insert after it
                        const recommendedIndex = items.findIndex(
                            (item) =>
                                item.overlayMessageRenderer?.subtitle
                                    ?.simpleText === "Recommended languages"
                        );

                        if (recommendedIndex > -1) {
                            items.splice(
                                recommendedIndex + 1,
                                0,
                                userLanguageOption
                            );
                            existingLanguages.add(userLanguage.code);
                            existingLanguages.add(userLanguage.name);
                        } else {
                            // Find "Other languages" section and insert before it
                            const otherLanguagesIndex = items.findIndex(
                                (item) =>
                                    item.overlayMessageRenderer?.subtitle
                                        ?.simpleText === "Other languages"
                            );

                            if (otherLanguagesIndex > -1) {
                                items.splice(
                                    otherLanguagesIndex,
                                    0,
                                    userLanguageOption
                                );
                            } else {
                                // As a fallback, add it at the beginning
                                items.unshift(userLanguageOption);
                            }
                            existingLanguages.add(userLanguage.code);
                            existingLanguages.add(userLanguage.name);
                        }
                    } else {
                        console.log(
                            `%c[subtitles] User's language ${userLanguage.name} already exists in menu`,
                            "background: #4CAF50; color: #ffffff; font-size: 12px;"
                        );
                    }
                } else {
                    console.warn(
                        `Subtitles: No language mapping found for country code: ${userCountryCode}`
                    );
                }
            }

            // "More languages": everything the menu is missing.
            if (showOtherLanguages) {
                const missingLanguages = Object.entries(getComprehensiveLanguageList())
                    .filter(([code, name]) => !existingLanguages.has(code) && !existingLanguages.has(name))
                    .sort(([, a], [, b]) => a.localeCompare(b));

                if (missingLanguages.length > 0) {
                    console.log(
                        `%c[subtitles] Adding "More languages" section with ${missingLanguages.length} additional languages`,
                        "background: #FF9800; color: #ffffff; font-size: 12px;"
                    );

                    items.push(createSectionTitle("Other Languages"));

                    missingLanguages.forEach(([code, name]) => {
                        items.push(createLanguageOption(code, name));
                    });

                    console.log(
                        `%c[subtitles] Added "More languages" section`,
                        "background: #FF9800; color: #ffffff; font-size: 12px;"
                    );
                } else {
                    console.log(
                        `%c[subtitles] All languages already present in menu`,
                        "background: #4CAF50; color: #ffffff; font-size: 12px;"
                    );
                }
            }
        }

        return originalResolveCommand.apply(this, arguments);
    };

    yttvInstance.instance.resolveCommand.isPatchedBySubtitleLocalization = true;
    console.log("Subtitles: Patch successful!");
    isPatched = true;
}

// Wait for the YouTube TV app to be ready.
const interval = setInterval(() => {
    if (window._yttv && Object.keys(window._yttv).length > 0) {
        patchSubtitleMenu();
        clearInterval(interval);
    }
}, 1000);

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", patchSubtitleMenu);
} else {
    patchSubtitleMenu();
}

console.log(
    "Subtitles: Module loaded, waiting for YouTube TV..."
);
