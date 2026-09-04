import { findAssignedProperty } from "../utils/findAssignments.js";
import { configRead } from "../config.js";
import { ButtonRenderer } from "./ytUI.js";

// The row of buttons under the player mounts before YouTube has the video's data: props.data
// is an empty object and every group draws a grey placeholder in place of its buttons. Only
// Play, which needs nothing, is real. Anything added during that window is the one live
// control in an otherwise dead row — and when the data lands the groups are rebuilt from
// scratch, so whatever was added is destroyed and the highlight lands wherever the focus
// engine falls back to. Waiting costs the buttons about a second and buys the row back.
function rowHasData(instance) {
    const data = instance && instance.props && instance.props.data;
    if (!data) return false;

    return !!(data.engagementActions || data.settingActions || data.promotedActions
        || data.skipPreviousButton || data.skipNextButton);
}

// Off, the buttons go in the moment the row exists, the way they always did.
function stillWaiting(instance) {
    return configRead('enableImprovedPlayerUI') && !rowHasData(instance);
}

function takesNoArguments(rhs) {
    return /^\s*(?:function\s*)?\(\s*\)\s*(?:=>|\{)/.test(rhs);
}

// YouTube sizes the grey pills in the skeleton for its own buttons and nothing else: four
// slots where like, dislike, comments and save are going, and two for captions and settings.
// The speed and mini player buttons this app adds are not in that count, so each pill comes
// up a slot narrower than the row it turns into and that side of the player steps sideways
// the moment the data arrives. Handing the pills their slots up front is the difference
// between the row filling in and the row jumping.
//
// YouTube's own two-slot guess for the settings pill is optimistic — it is reserving for a
// captions button that videos without subtitles never draw — but whether this video has
// captions is exactly what is not known yet, so that guess is left alone and only what we
// add on top of it is counted.
function pillsIn(row) {
    const pills = [];

    Array.prototype.forEach.call(row.children, (group) => {
        Array.prototype.forEach.call(group.children, (child) => {
            if (!child.querySelector('[role="button"]')) pills.push(child);
        });
    });

    return pills;
}

// One slot is the narrowest pill in the row — the channel avatar, or previous and next.
function slotWidth(pills) {
    return pills.reduce((narrowest, pill) => {
        const width = pill.getBoundingClientRect().width;
        return width && (!narrowest || width < narrowest) ? width : narrowest;
    }, 0);
}

function widen(pill, extra) {
    if (!pill || !extra || pill.getAttribute('data-tube-reserved')) return;

    const width = pill.getBoundingClientRect().width;
    if (!width) return;

    pill.setAttribute('data-tube-reserved', '1');
    pill.style.width = `${width + extra}px`;
}

// True for as long as the row is still worth watching.
function reserveOurSlots() {
    const row = document.querySelector('ytlr-player-actions-container');
    if (!row || !row.children.length) return true;

    const pills = pillsIn(row);
    if (!pills.length) return false;

    const slot = slotWidth(pills);
    if (!slot) return true;

    const group = row.children[row.children.length - 1];
    const waiting = Array.prototype.filter.call(group.children,
        (child) => !child.querySelector('[role="button"]'));

    widen(waiting[0], configRead('enableSpeedControlsButton') ? slot : 0);
    widen(waiting[1], configRead('enableMPButton') ? slot : 0);

    return true;
}

let reserving = null;

function reserveWhileSkeleton() {
    if (!configRead('enableImprovedPlayerUI')) return;
    if (!configRead('enablePatchingVideoPlayer')) return;
    if (!configRead('enableSpeedControlsButton') && !configRead('enableMPButton')) return;

    if (reserving) clearInterval(reserving);

    let ticks = 0;
    reserving = setInterval(() => {
        // Close enough to the pills appearing that they are never seen at the wrong width.
        // The skeleton is up for a second or so; give it fifteen and then stop looking.
        if (++ticks > 500 || !reserveOurSlots()) {
            clearInterval(reserving);
            reserving = null;
        }
    }, 30);
}

window.addEventListener('hashchange', () => {
    if (location.hash.indexOf('watch') !== -1) reserveWhileSkeleton();
});

function applyPatches() {
    if (!window._yttv) return setTimeout(applyPatches, 250);
    if (!document.querySelector('video')) return setTimeout(applyPatches, 250);
    const methods = Object.keys(window._yttv).filter(key => {
        return typeof window._yttv[key] === 'function' && window._yttv[key].toString().includes('TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION');
    });

    if (methods.length === 0) {
        setTimeout(applyPatches, 250);
        return;
    }

    const origMethod = window._yttv[methods[0]];

    function YtlrPlayerActionsContainer() {
        const args = Array.prototype.slice.call(arguments);
        const isClass = /^class\s/.test(origMethod.toString());

        function constructAsNew(ctor, argsList) {
            if (typeof Reflect !== 'undefined' && typeof Reflect.construct === 'function') {
                return Reflect.construct(ctor, argsList, YtlrPlayerActionsContainer);
            }
            return new origMethod(...argsList);
        }

        if (!(this instanceof YtlrPlayerActionsContainer)) {
            if (isClass) return constructAsNew(origMethod, args);
            return origMethod.apply(this, args);
        }

        let inst;
        if (isClass) {
            inst = constructAsNew(origMethod, args);
        } else {
            origMethod.apply(this, args);
            inst = this;
        }

        const source = origMethod.toString();

        const pipCommand = {
            "type": "TRANSPORT_CONTROLS_BUTTON_TYPE_PIP",
            "button": {
                "buttonRenderer": ButtonRenderer(
                    false,
                    configRead('enableSwapMPWithPIP') ? 'Picture in Picture' : 'Mini Player',
                    'CLEAR_COOKIES',
                    {
                        customAction: {
                            action: configRead('enableSwapMPWithPIP') ? 'ENTER_PIP' : 'ENTER_MP',
                        }
                    }
                )
            }
        }

        // Two methods mention the playback settings button: the one that builds the settings
        // menu, which takes the menu's options as an argument, and the one that builds the
        // group the row actually draws, which takes nothing. The menu comes first in the
        // source, so matching on the button type alone finds the wrong one and the mini
        // player button gets spliced into a menu instead of the row — which is why it never
        // appeared. Only the row's group is called with no arguments.
        const settingActionGroup = findAssignedProperty(source, rhs =>
            rhs.includes('TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS')
            && takesNoArguments(rhs));

        if (!settingActionGroup) return inst;

        const origSettingActionGroup = inst[settingActionGroup];
        if (configRead('enableMPButton')) {
            inst[settingActionGroup] = function () {
                const res = origSettingActionGroup.apply(this, arguments);
                if (stillWaiting(this)) return res;
                const idx = res.findIndex(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS');
                res.find(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP') || res.splice(idx, 0, pipCommand);
                return res;
            };
        }

        const previousButtonName = findAssignedProperty(source, rhs => {
            const next = rhs.indexOf('skipNextButton');
            const previous = rhs.indexOf('skipPreviousButton');
            return next !== -1 && previous > next;
        });

        const nextButtonName = findAssignedProperty(source, rhs => {
            const next = rhs.indexOf('skipNextButton');
            const previous = rhs.indexOf('skipPreviousButton');
            return previous !== -1 && next > previous;
        });

        const engagementActionButton = findAssignedProperty(source, rhs =>
            rhs.includes('props.data.engagementActions'));

        if (engagementActionButton && configRead('enableSpeedControlsButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                if (stillWaiting(this)) return res;
                res.find(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED') || res.push({
                    type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED',
                    button: {
                        buttonRenderer: ButtonRenderer(
                            false,
                            'Speed Controls',
                            'SLOW_MOTION_VIDEO',
                            {
                                customAction:
                                {
                                    action: 'OPEN_SPEED_OPTIONS',
                                }
                            }
                        )
                    }
                });
                return res;
            }
        }

        if (engagementActionButton && !configRead('enableSuperThanksButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                const superThanksFiltered = res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SUPER_THANKS');
                const shoppingFiltered = superThanksFiltered.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_SHOPPING');
                return shoppingFiltered;
            }
        }

        if (engagementActionButton && !configRead('enableAIAskButton')) {
            const origEngagementActionButton = inst[engagementActionButton];
            inst[engagementActionButton] = function () {
                const res = origEngagementActionButton.apply(this, arguments);
                const superThanksFiltered = res.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_YOUCHAT_BUTTON');
                const shoppingFiltered = superThanksFiltered.filter(item => item.type !== 'TRANSPORT_CONTROLS_BUTTON_TYPE_YOUCHAT_BUTTON');
                return shoppingFiltered;
            }
        }

        if (configRead('enablePreviousNextButtons')) {
            if (!previousButtonName || !nextButtonName) return inst;

            const origPreviousButton = inst[previousButtonName];
            const origNextButton = inst[nextButtonName];
            inst[previousButtonName] = function () {
                if (stillWaiting(this)) return origPreviousButton.apply(this, arguments);
                return ButtonRenderer(
                    false,
                    'Previous',
                    'SKIP_PREVIOUS',
                    {
                        signalAction: {
                            signal: 'PLAYER_PLAY_PREVIOUS'
                        }
                    }
                )
            }

            inst[nextButtonName] = function () {
                if (stillWaiting(this)) return origNextButton.apply(this, arguments);
                return ButtonRenderer(
                    false,
                    'Next',
                    'SKIP_NEXT',
                    {
                        signalAction: {
                            signal: 'PLAYER_PLAY_NEXT'
                        }
                    }
                )
            }

        }

        return inst;
    }

    if (configRead('enablePatchingVideoPlayer')) {
        YtlrPlayerActionsContainer.prototype = origMethod.prototype;
        window._yttv[methods[0]] = YtlrPlayerActionsContainer;
    }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    applyPatches();
} else {
    window.addEventListener('DOMContentLoaded', applyPatches);
}