'use strict';

// A ship build resolves this module to none.js, so the /eval endpoint — arbitrary source behind one
// header check on a server bound to 0.0.0.0 — never enters the bundle.

const bridge = require('./bridge.js');
const chii = require('./chii.js');
const journal = require('./journal.js');
const { readFileSync } = require('fs');
const postmortem = require('../lib/postmortem.js');

const DEV_USER_AGENT = process.env.TUBE_DEV_UA || '';
const DEV_INJECT_PATH = process.env.TUBE_DEV_INJECT || '';

// A desktop browser standing in for the set asks YouTube as itself and gets the desktop site back.
const spoofUserAgent = (text) => {
    if (!DEV_USER_AGENT) return text;

    const shim = '<script>try{Object.defineProperty(navigator,"userAgent",'
        + `{get:function(){return ${JSON.stringify(DEV_USER_AGENT)};},configurable:true});`
        + '}catch(e){}</script>';

    // No <head> means an unexpected shape; leaving it alone beats guessing.
    return text.indexOf('<head>') === -1 ? text : text.replace('<head>', `<head>${shim}`);
};

const upstreamHeaders = (headers) => (DEV_USER_AGENT
    ? Object.assign({}, headers, { 'user-agent': DEV_USER_AGENT })
    : headers);

// The remote, so a keyboard can press a TV button.
const pageScripts = (origin, stamp) => (DEV_INJECT_PATH
    ? `<script${stamp} src="${origin}/__tube/dev.js?v=${Date.now()}"></script>`
    : '');

const pageRoutes = (app) => {
    chii.routes(app);
    if (!DEV_INJECT_PATH) return;

    app.get('/__tube/dev.js', (_, res) => {
        try {
            res.type('application/javascript').send(readFileSync(DEV_INJECT_PATH, 'utf8'));
        } catch (e) {
            res.status(500).type('application/javascript')
                .send(`console.error(${JSON.stringify(`tube: could not read ${DEV_INJECT_PATH} - ${e.message}`)});`);
        }
    });
};

const routes = (app, { policies, state, knobs, relaunch }) => {
    app.get('/__tube/dev/relaunch', (_, res) => {
        if (!relaunch) return res.status(501).json({ ok: false, why: 'no container route on this set' });

        // Answered before the kill lands: this connection dies with the app it is restarting.
        res.json({ ok: true, restarting: true });

        return relaunch((error, result) => {
            if (error) postmortem.note('relaunch', postmortem.describe(error));
            else postmortem.note('relaunch', `done, ${result.killed} context(s) killed`);
        });
    });

    app.get('/__tube/dev/csp', (req, res) => {
        const asked = String((req.query && req.query.policy) || '');
        if (Object.prototype.hasOwnProperty.call(policies, asked)) state.policy = asked;

        res.json({ policy: state.policy, sends: policies[state.policy] });
    });

    // ?html5_onesie=false sets one flag (repeatable, then reload); ?clear=1 restores YouTube's own.
    app.get('/__tube/dev/flags', (req, res) => {
        if (req.query.clear) knobs.flagOverrides.clear();

        Object.keys(req.query).forEach((name) => {
            if (name === 'clear' || !/^[a-z0-9_]{3,64}$/.test(name)) return;

            const value = String(req.query[name]).slice(0, 32);
            if (/^[A-Za-z0-9_.-]*$/.test(value)) knobs.flagOverrides.set(name, value);
        });

        res.json({ flags: Object.fromEntries(knobs.flagOverrides) });
    });

    // /__tube/dev/upstream?origin=pass|drop|<url>&abr=service&onesie=fail&patches=off
    app.get('/__tube/dev/upstream', (req, res) => {
        if (req.query.origin) knobs.upstream.origin = String(req.query.origin).slice(0, 128);
        if (req.query.abr) knobs.upstream.abrThroughService = req.query.abr === 'service';
        if (req.query.patches) knobs.upstream.nativeProxyPatches = req.query.patches !== 'off';

        if (req.query.onesie) {
            const asked = String(req.query.onesie);
            knobs.upstream.onesie = asked === 'fail' ? asked : 'auto';
        }

        res.json({
            origin: knobs.upstream.origin,
            abr: knobs.upstream.abrThroughService ? 'service' : 'direct',
            onesie: knobs.upstream.onesie,
            patches: knobs.upstream.nativeProxyPatches ? 'on' : 'off'
        });
    });
};

// Holds the port shut, to reproduce the start race.
const BUILD_DELAY = '__TUBE_START_DELAY__';
const startDelay = () => Number(process.env.TUBE_START_DELAY
    || (BUILD_DELAY.indexOf('TUBE_START_DELAY') === -1 ? BUILD_DELAY : 0)) || 0;

module.exports = {
    attach: bridge.attach,
    startDelay,
    routes,
    pageRoutes,
    pageScripts,
    upgradeRewrite: chii.upgradeRewrite,
    spoofUserAgent,
    upstreamHeaders,
    journal
};
