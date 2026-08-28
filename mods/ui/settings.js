import { configRead } from '../config.js';
import { showModal, buttonItem, overlayPanelItemListRenderer } from './ytUI.js';

export function openAdditionalOptions(update, parameters) {
    const settings = [
        {
            name: 'Ad Block',
            icon: 'DOLLAR_SIGN',
            value: 'enableAdBlock'
        },
        {
            name: 'SponsorBlock Settings',
            icon: 'MONEY_HAND',
            value: null,
            menuId: 'options-sponsorblock',
            menuHeader: {
                title: 'SponsorBlock Settings',
                subtitle: 'https://sponsor.ajay.app/'
            },
            options: [
                {
                    name: 'Enable SponsorBlock',
                    icon: 'MONEY_HAND',
                    value: 'enableSponsorBlock'
                },
                {
                    name: 'Manual SponsorBlock Segment Skip',
                    icon: 'DOLLAR_SIGN',
                    value: null,
                    arrayToEdit: 'sponsorBlockManualSkips',
                    menuId: 'options-sponsorblock-manual',
                    options: [
                        {
                            name: 'Skip Sponsor Segments',
                            icon: 'MONEY_HEART',
                            value: 'sponsor'
                        },
                        {
                            name: 'Skip Intro Segments',
                            icon: 'PLAY_CIRCLE',
                            value: 'intro'
                        },
                        {
                            name: 'Skip Outro Segments',
                            value: 'outro'
                        },
                        {
                            name: 'Skip Interaction Reminder Segments',
                            value: 'interaction'
                        },
                        {
                            name: 'Skip Self-Promotion Segments',
                            value: 'selfpromo'
                        },
                        {
                            name: 'Skip Preview/Recap Segments',
                            value: 'preview'
                        },
                        {
                            name: 'Skip Tangents/Jokes Segments',
                            value: 'filler'
                        },
                        {
                            name: 'Skip Off-Topic Music Segments',
                            value: 'music_offtopic'
                        }
                    ]
                },
                {
                    name: 'Segments',
                    icon: 'SETTINGS',
                    value: null,
                    menuId: 'options-sponsorblock-segments',
                    options: [
                        {
                            name: 'Skip Sponsor Segments',
                            icon: 'MONEY_HEART',
                            value: 'enableSponsorBlockSponsor'
                        },
                        {
                            name: 'Skip Intro Segments',
                            icon: 'PLAY_CIRCLE',
                            value: 'enableSponsorBlockIntro'
                        },
                        {
                            name: 'Skip Outro Segments',
                            value: 'enableSponsorBlockOutro'
                        },
                        {
                            name: 'Skip Interaction Reminder Segments',
                            value: 'enableSponsorBlockInteraction'
                        },
                        {
                            name: 'Skip Self-Promotion Segments',
                            value: 'enableSponsorBlockSelfPromo'
                        },
                        {
                            name: 'Skip Preview/Recap Segments',
                            value: 'enableSponsorBlockPreview'
                        },
                        {
                            name: 'Skip Tangents/Jokes Segments',
                            value: 'enableSponsorBlockFiller'
                        },
                        {
                            name: 'Skip Off-Topic Music Segments',
                            value: 'enableSponsorBlockMusicOfftopic'
                        },
                        {
                            name: 'Enable Highlights',
                            icon: 'LOCATION_POINT',
                            value: 'enableSponsorBlockHighlight'
                        }
                    ]
                },
                {
                    name: 'Show SponsorBlock Toasts',
                    value: 'enableSponsorBlockToasts'
                }
            ]
        },
        {
            name: 'DeArrow Settings',
            icon: 'VISIBILITY_OFF',
            value: null,
            menuHeader: {
                title: 'DeArrow Settings',
                subtitle: 'https://dearrow.ajay.app/'
            },
            options: [
                {
                    name: 'Enable DeArrow',

                    icon: 'VISIBILITY_OFF',
                    value: 'enableDeArrow'
                },
                {
                    name: 'Enable DeArrow Thumbnails',
                    icon: 'TV',
                    value: 'enableDeArrowThumbnails'
                }
            ]
        },
        {
            name: 'Miscellaneous Settings',
            icon: 'SETTINGS',
            value: null,
            options: [
                {
                    name: 'Hide End Screen Cards',

                    icon: 'VISIBILITY_OFF',
                    value: 'enableHideEndScreenCards'
                },
                {
                    name: "Enable 'Are you still watching?' Renderer",
                    icon: 'HELP',
                    value: 'enableYouThereRenderer'
                },
                {
                    name: "Enable 'Includes paid promotion' Overlay",
                    icon: 'MONEY_HAND',
                    value: 'enablePaidPromotionOverlay'
                },
                {
                    name: "Who's Watching Menu",
                    icon: 'ACCOUNT_CIRCLE',
                    menuId: 'options-whos-watching',
                    value: null,
                    options: [
                        {
                            name: "Enable Who's Watching Menu",
                            value: 'enableWhoIsWatchingMenu'
                        },
                        {
                            name: "Permanently Enable Who's Watching Menu",
                            value: 'permanentlyEnableWhoIsWatchingMenu'
                        },
                        {
                            name: "Enable Who's Watching Menu on App Exit",
                            value: 'enableWhosWatchingMenuOnAppExit'
                        }
                    ]
                },
                {
                    name: 'Fix UI',
                    icon: 'STAR',
                    value: 'enableFixedUI'
                },
                {
                    name: 'Enable High Quality Thumbnails',
                    icon: 'VIDEO_QUALITY',
                    value: 'enableHqThumbnails'
                },
                {
                    name: 'Enable Long Press Actions',
                    value: 'enableLongPress'
                },
                {
                    name: 'Enable Shorts',
                    icon: 'YOUTUBE_SHORTS_FILL_24',
                    value: 'enableShorts'
                },
                {
                    name: 'Enable Video Previews',
                    value: 'enablePreviews'
                },
                {
                    name: 'Show Guest Sign In Reminder',
                    value: 'enableSigninReminder'
                },
                {
                    name: 'Reload Home on Startup',
                    value: 'reloadHomeOnStartup'
                }
            ]
        },
        {
            name: 'Subtitle Settings',
            icon: 'TRANSLATE',
            value: null,
            options: [
                {
                    name: 'Show Local Subtitle',
                    value: 'enableShowUserLanguage'
                },
                {
                    name: 'Show Hidden Subtitles',
                    value: 'enableShowOtherLanguages'
                }
            ]
        },
        {
            name: 'Video Player Settings',
            icon: 'VIDEO_YOUTUBE',
            value: null,
            menuHeader: {
                title: 'Video Player Settings',
                subtitle: 'Customize video player features'
            },
            options: [
                {
                    name: 'Patch Video Player UI',
                    icon: 'SETTINGS',
                    value: null,
                    menuId: 'options-player-buttons',
                    options: [
                        {
                            name: 'Enable Video Player UI Patching',
                            icon: 'SETTINGS',
                            value: 'enablePatchingVideoPlayer'
                        },
                        {
                            name: 'Enable Previous and Next Buttons',
                            icon: 'SKIP_NEXT',
                            value: 'enablePreviousNextButtons'
                        },
                        {
                            name: 'Show Super Thanks Button',
                            icon: 'MONEY_HEART',
                            value: 'enableSuperThanksButton'
                        },
                        {
                            name: 'Show Ask Button',
                            icon: 'SPARK',
                            value: 'enableAIAskButton'
                        },
                        {
                            name: 'Show Speed Controls Button',
                            icon: 'SLOW_MOTION_VIDEO',
                            value: 'enableSpeedControlsButton'
                        },
                        {
                            name: 'Show Mini Player Button',
                            icon: 'CLEAR_COOKIES',
                            value: 'enableMPButton'
                        },
                        {
                            name: 'Swap Mini Player Button with PiP Button',
                            icon: 'CLEAR_COOKIES',
                            value: 'enableSwapMPWithPIP'
                        }
                    ]
                },
                {
                    name: 'Preferred Video Quality',
                    icon: 'VIDEO_QUALITY',
                    value: null,
                    menuId: 'options-quality',
                    menuHeader: {
                        title: 'Preferred Video Quality',
                        subtitle: 'Choose the preferred or next best video quality applied when playback starts'
                    },
                    // "Highest" leads: it is the answer almost every time on a TV, and
                    // the only option that cannot silently do nothing.
                    options:
                        ['Highest', 'Auto', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'].map((quality) => {
                            return {
                                name: quality === 'Auto' ? 'Auto'
                                    : quality === 'Highest' ? 'Highest'
                                    : quality,
                                key: 'preferredVideoQuality',
                                value: quality.toLowerCase()
                            }
                        })

                },
                {
                    name: 'Speed Settings Increments',
                    icon: 'SLOW_MOTION_VIDEO',
                    value: null,
                    menuId: 'options-speed-increments',
                    menuHeader: {
                        title: 'Speed Settings Increments',
                        subtitle: 'Set the speed increments for video playback speed adjustments'
                    },
                    options: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map((increment) => {
                        return {
                            name: `${increment}x`,
                            key: 'speedSettingsIncrement',
                            value: increment
                        }
                    })
                },
                {
                    name: 'Preferred Video Codec',
                    icon: 'VIDEO_QUALITY',
                    value: null,
                    menuId: 'options-codec',
                    menuHeader: {
                        title: 'Preferred Video Codec',
                        subtitle: 'Choose the preferred video codec for playback'
                    },
                    // `videoPreferredCodec`, not `preferredVideoCodec` — adblock.js's
                    // filter reads the former and this menu wrote the latter.
                    options: ['any', 'vp9', 'av01', 'avc1'].map((codec) => {
                        return {
                            name: codec === 'any' ? 'Any' : codec.toUpperCase(),
                            key: 'videoPreferredCodec',
                            value: codec
                        }
                    })
                }
            ]
        },
        {
            name: 'User Interface Settings',
            icon: 'SETTINGS',
            value: null,
            menuHeader: {
                title: 'User Interface Settings',
                subtitle: 'Customize the UI to your liking'
            },
            options: [
                {
                    name: 'Hide Watched Videos',
                    icon: 'VISIBILITY_OFF',
                    value: null,
                    menuId: 'options-hide-watched',
                    options: [
                        {
                            name: 'Enable Hide Watched Videos',
                            icon: 'VISIBILITY_OFF',
                            value: 'enableHideWatchedVideos'
                        },
                        {
                            name: 'Watched Videos Threshold',
                            value: null,
                            menuId: 'options-hide-watched-threshold',
                            menuHeader: {
                                title: 'Watched Videos Threshold',
                                subtitle: 'Set the percentage threshold for hiding watched videos'
                            },
                            options: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((percent) => {
                                return {
                                    name: `${percent}%`,
                                    key: 'hideWatchedVideosThreshold',
                                    value: percent
                                }
                            })
                        },
                        {
                            name: 'Set Pages to Hide Watched Videos',
                            value: null,
                            arrayToEdit: 'hideWatchedVideosPages',
                            menuId: 'options-hide-watched-pages',
                            options: [
                                {
                                    name: 'Search Results',
                                    value: 'search'
                                },
                                {
                                    name: 'Home',
                                    value: 'home'
                                },
                                {
                                    name: 'Music',
                                    value: 'music'
                                },
                                {
                                    name: 'Gaming',
                                    value: 'gaming'
                                },
                                {
                                    name: 'Subscriptions',
                                    value: 'subscriptions'
                                },
                                {
                                    name: 'Library',
                                    value: 'library'
                                },
                                {
                                    name: 'More',
                                    value: 'more'
                                }
                            ]
                        }
                    ]
                },
                {
                    name: 'Disable Sidebar Contents',
                    icon: 'MENU',
                    value: null,
                    arrayToEdit: 'disabledSidebarContents',
                    menuId: 'options-sidebar',
                    menuHeader: {
                        title: 'Disable Sidebar Contents',
                        subtitle: 'Select sidebar contents to disable'
                    },
                    options: [
                        {
                            name: 'Search',
                            icon: 'SEARCH',
                            value: 'SEARCH'
                        },
                        {
                            name: 'Home',
                            icon: 'WHAT_TO_WATCH',
                            value: 'WHAT_TO_WATCH'
                        },
                        {
                            name: 'Sports',
                            icon: 'TROPHY',
                            value: 'TROPHY'
                        },
                        {
                            name: 'News',
                            icon: 'NEWS',
                            value: 'NEWS'
                        },
                        {
                            name: 'Music',
                            icon: 'YOUTUBE_MUSIC',
                            value: 'YOUTUBE_MUSIC'
                        },
                        {
                            name: 'Podcasts',
                            icon: 'BROADCAST',
                            value: 'BROADCAST'
                        },
                        {
                            name: 'Movies & TV',
                            icon: 'CLAPPERBOARD',
                            value: 'CLAPPERBOARD'
                        },
                        {
                            name: 'Live',
                            icon: 'LIVE',
                            value: 'LIVE'
                        },
                        {
                            name: 'Gaming',
                            icon: 'GAMING',
                            value: 'GAMING'
                        },
                        {
                            name: 'Subscriptions',
                            icon: 'SUBSCRIPTIONS',
                            value: 'SUBSCRIPTIONS'
                        },
                        {
                            name: 'Library',
                            icon: 'TAB_LIBRARY',
                            value: 'TAB_LIBRARY'
                        },
                        {
                            name: 'More',
                            icon: 'TAB_MORE',
                            value: 'TAB_MORE'
                        },
                        {
                            name: 'Shorts',
                            icon: 'YOUTUBE_SHORTS_FILL_24',
                            value: 'YOUTUBE_SHORTS_FILL_24'
                        }
                    ]
                },
                {
                    name: 'Launch To on Startup',
                    icon: 'TV',
                    value: null,
                    menuId: 'options-start-page',
                    menuHeader: {
                        title: 'Launch To on Startup',
                        subtitle: 'Choose the page to open on startup'
                    },
                    options: [
                        {
                            name: 'Search',
                            icon: 'SEARCH',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                searchEndpoint: { query: '' }
                            })
                        },
                        {
                            name: 'Home',
                            icon: 'WHAT_TO_WATCH',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics' }
                            })
                        },
                        {
                            name: 'Sports',
                            icon: 'TROPHY',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_sports' }
                            })
                        },
                        {
                            name: 'News',
                            icon: 'NEWS',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_news' }
                            })
                        },
                        {
                            name: 'Music',
                            icon: 'YOUTUBE_MUSIC',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_music' }
                            })
                        },
                        {
                            name: 'Podcasts',
                            icon: 'BROADCAST',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_podcasts' }
                            })
                        },
                        {
                            name: 'Movies & TV',
                            icon: 'CLAPPERBOARD',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_movies' }
                            })
                        },
                        {
                            name: 'Gaming',
                            icon: 'GAMING',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_gaming' }
                            })
                        },
                        {
                            name: 'Live',
                            icon: 'LIVE',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_live' }
                            })
                        },
                        {
                            name: 'Subscriptions',
                            icon: 'SUBSCRIPTIONS',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEsubscriptions' }
                            })
                        },
                        {
                            name: 'Library',
                            icon: 'TAB_LIBRARY',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FElibrary' }
                            })
                        },
                        {
                            name: 'More',
                            icon: 'TAB_MORE',
                            key: 'launchToOnStartup',
                            value: JSON.stringify({
                                browseEndpoint: { browseId: 'FEtopics_more' }
                            })
                        }
                    ]
                },
                {
                    name: 'Sort Subscriptions Alphabetically',
                    icon: 'SUBSCRIPTIONS',
                    value: 'sortSubscriptionsByAlphabet'
                },
                {
                    name: 'Disable Channels on Sidebar',
                    value: 'disableChannelsOnSidebar'
                }
            ]
        }
    ];

    const buttons = [];

    let index = 0;
    for (const setting of settings) {
        if (!setting) continue;
        const currentVal = setting.value ? configRead(setting.value) : null;
        buttons.push(
            buttonItem(
                { title: setting.name, subtitle: setting.subtitle },
                {
                    icon: setting.icon ? setting.icon : 'CHEVRON_DOWN',
                    secondaryIcon:
                        currentVal === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                },
                currentVal !== null
                    ? [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: setting.value
                                        },
                                        boolValue: !configRead(setting.value)
                                    }
                                ]
                            }
                        },
                        {
                            customAction: {
                                action: 'SETTINGS_UPDATE',
                                parameters: [index]
                            }
                        }
                    ]
                    : [
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: setting.options,
                                    selectedIndex: 0,
                                    update: setting.options?.title ? 'customUI' : false,
                                    menuId: setting.menuId,
                                    arrayToEdit: setting.arrayToEdit,
                                    menuHeader: setting.menuHeader
                                }
                            }
                        }
                    ]
            )
        );
        index++;
    }

    showModal(
        { title: 'Additional options' },
        overlayPanelItemListRenderer(buttons, parameters && parameters.length > 0 ? parameters[0] : 0),
        'options',
        update
    );
}

export function openOptionsSubmenu(parameters, update) {
    if (update === 'customUI') {
        const option = parameters.options;
        showModal(
            {
                title: option.title,
                subtitle: option.subtitle
            },
            option.content,
            'options-detail',
            false
        );
        return;
    }
    const buttons = [];

    // Legacy array-based sponsorBlockManualSkips, or the newer boolean options.
    const isArrayBasedOptions = parameters.arrayToEdit !== undefined;

    if (isArrayBasedOptions) {
        const value = configRead(parameters.arrayToEdit);
        for (const option of parameters.options) {
            buttons.push(
                buttonItem(
                    { title: option.name, subtitle: option.subtitle },
                    {
                        icon: option.icon ? option.icon : 'CHEVRON_DOWN',
                        secondaryIcon: value.includes(option.value) ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                    },
                    [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: parameters.arrayToEdit
                                        },
                                        arrayValue: option.value
                                    }
                                ]
                            }
                        },
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: parameters.options,
                                    selectedIndex: parameters.options.indexOf(option),
                                    update: true,
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
                                }
                            }
                        }
                    ]
                )
            );
        }
    } else {
        let index = 0;
        for (const option of parameters.options) {
            if (!option) continue;
            if (option.compactLinkRenderer) {
                buttons.push(option);
                index++;
                continue;
            }
            const isRadioChoice = option.key !== null && option.key !== undefined;
            const currentVal = option.value === null ? undefined : configRead(isRadioChoice ? option.key : option.value);
            buttons.push(
                buttonItem(
                    { title: option.name, subtitle: option.subtitle },
                    {
                        icon: option.icon ? option.icon : 'CHEVRON_DOWN',
                        secondaryIcon: isRadioChoice ? currentVal === option.value ? 'RADIO_BUTTON_CHECKED' : 'RADIO_BUTTON_UNCHECKED' : option.value === null ? 'CHEVRON_RIGHT' : currentVal ? 'CHECK_BOX' : 'CHECK_BOX_OUTLINE_BLANK'
                    },
                    option.value === null ? [
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: option.options,
                                    selectedIndex: 0,
                                    update: option.options?.title ? 'customUI' : false,
                                    menuId: option.menuId,
                                    arrayToEdit: option.arrayToEdit,
                                    menuHeader: option.menuHeader
                                }
                            }
                        }
                    ] : option.key !== null && option.key !== undefined ? [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: option.key
                                        },
                                        stringValue: option.value
                                    }
                                ]
                            }
                        },
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: parameters.options,
                                    selectedIndex: index,
                                    update: parameters.options?.title ? 'customUI' : true,
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
                                }
                            }
                        }
                    ] : [
                        {
                            setClientSettingEndpoint: {
                                settingDatas: [
                                    {
                                        clientSettingEnum: {
                                            item: option.value
                                        },
                                        boolValue: !currentVal
                                    }
                                ]
                            }
                        },
                        {
                            customAction: {
                                action: 'OPTIONS_SHOW',
                                parameters: {
                                    options: parameters.options,
                                    selectedIndex: index,
                                    update: parameters.options?.title ? 'customUI' : true,
                                    menuId: parameters.menuId,
                                    arrayToEdit: parameters.arrayToEdit,
                                    menuHeader: parameters.menuHeader
                                }
                            }
                        }
                    ]
                )
            );
            index++;
        }
    }

    showModal(parameters.menuHeader ? parameters.menuHeader : 'Additional options', overlayPanelItemListRenderer(buttons, parameters.selectedIndex), parameters.menuId || 'options-submenu', update);
}
