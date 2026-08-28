'use strict';

// DIAL server: what the phone's YouTube app discovers when you press cast. The launch
// payload is handed to the app shell as an app-control argument, which the injector
// appends to the watch URL.

const dial = require('@patrickkfkan/peer-dial');
const express = require('express');
const cors = require('cors');
const uuid = require('uuid');

const ports = require('./ports.js');

function parseLaunchData(launchData) {
    return String(launchData || '').split('&').reduce((acc, pair) => {
        const index = pair.indexOf('=');
        if (index === -1) {
            if (pair) acc[pair] = '';
        } else {
            acc[pair.slice(0, index)] = pair.slice(index + 1);
        }
        return acc;
    }, {});
}

function start() {
    const app = express();
    app.use(cors({ origin: '*', methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', credentials: true, optionsSuccessStatus: 204 }));

    const appId = `${tizen.application.getAppInfo().packageId}.Tube`;

    const apps = {
        YouTube: {
            name: 'YouTube',
            state: 'stopped',
            allowStop: true,
            pid: null,
            additionalData: {},
            launch(launchData) {
                tizen.application.launchAppControl(
                    new tizen.ApplicationControl(
                        'http://tizen.org/appcontrol/operation/view', null, null, null,
                        [new tizen.ApplicationControlData('args', [JSON.stringify({ args: launchData })])]
                    ),
                    appId
                );
            }
        }
    };

    const server = new dial.Server({
        expressApp: app,
        port: ports.DIAL,
        prefix: '/dial',
        manufacturer: 'tube',
        modelName: 'tube',
        friendlyName: `tube (${tizen.systeminfo.getCapability('http://tizen.org/system/model_name')})`,
        uuid: uuid.v5(
            tizen.systeminfo.getCapability('http://tizen.org/system/tizenid'),
            '4bcbc514-bdd6-4163-8215-316526fd1d9b'
        ),
        delegate: {
            getApp(name) {
                return apps[name];
            },
            launchApp(name, launchData, callback) {
                const entry = apps[name];
                if (!entry) return callback(null);

                const parsed = parseLaunchData(launchData);

                // A `yumi` payload is a state handoff from a running session, not a
                // request to launch anything.
                if (parsed.yumi) {
                    entry.additionalData = parsed;
                    entry.state = 'running';
                    return callback('');
                }

                entry.pid = 'run';
                entry.state = 'starting';
                entry.launch(launchData);
                entry.state = 'running';
                callback(entry.pid);
            },
            stopApp(name, pid, callback) {
                const entry = apps[name];
                if (entry && entry.pid === pid) {
                    entry.pid = null;
                    entry.state = 'stopped';
                    return callback(true);
                }
                callback(false);
            }
        }
    });

    // Reflect reality: if the app is gone, DIAL should not claim it is running.
    const poll = setInterval(() => {
        tizen.application.getAppsContext((contexts) => {
            if (!contexts.some((context) => context.appId === appId)) {
                apps.YouTube.state = 'stopped';
                apps.YouTube.pid = null;
                apps.YouTube.additionalData = {};
            }
        });
    }, 5000);

    app.listen(ports.DIAL, () => server.start());

    return { stop() { clearInterval(poll); } };
}

module.exports = { start, parseLaunchData };
