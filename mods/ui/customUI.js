// Custom UI for video player

import { findAssignedProperty } from "../utils/findAssignments.js";
import { configRead } from "../config.js";
import { ButtonRenderer } from "./ytUI.js";

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

        const settingActionGroup = findAssignedProperty(source, rhs =>
            rhs.includes('TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS'));

        if (!settingActionGroup) return inst;

        const origSettingActionGroup = inst[settingActionGroup];
        if (configRead('enableMPButton')) {
            inst[settingActionGroup] = function () {
                const res = origSettingActionGroup.apply(this, arguments);
                const idx = res.findIndex(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS');
                res.find(item => item.type === 'TRANSPORT_CONTROLS_BUTTON_TYPE_PIP') || res.splice(idx, 0, pipCommand);
                return res;
            };
        }

        // The two skip buttons are told apart by which marker appears first
        // in the same assignment.
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
            inst[previousButtonName] = function () {
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