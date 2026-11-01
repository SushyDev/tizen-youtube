'use strict';

// Cobalt in the container runs on UTC, so the page tells YouTube it sits at +0 and every time
// YouTube writes out for it, a premiere or a scheduled live, comes out an hour or two early.
// The service runs on the set's own clock, which knows where the set is.

const OFFSET_HEADER = 'x-youtube-utc-offset';
const NAME_HEADER = 'x-youtube-time-zone';

const tizenName = () => {
    try {
        return typeof tizen === 'undefined' || !tizen.time ? null : tizen.time.getLocalTimezone() || null;
    } catch (e) {
        return null;
    }
};

// Read each time rather than once: the service outlives a change to or from summer time.
const current = () => ({ utcOffsetMinutes: -new Date().getTimezoneOffset(), timeZone: tizenName() });

// Only headers the page already sends are corrected, so a request that never named a zone still
// does not.
const correctHeaders = (headers, zone) => {
    if (!(OFFSET_HEADER in headers)) return headers;

    const named = zone.timeZone ? { [NAME_HEADER]: zone.timeZone } : {};
    return Object.assign({}, headers, { [OFFSET_HEADER]: String(zone.utcOffsetMinutes) }, named);
};

// What the page needs to put the same zone in its request bodies.
const pageTag = (zone) => `<script>window.__TUBE_ZONE__=${JSON.stringify(zone)};</script>`;

module.exports = { current, correctHeaders, pageTag };
