'use strict';

// Written in ES5 because this file is never transpiled and must parse on the oldest Node in the matrix.

var http = require('http');
var os = require('os');
var fs = require('fs');
var path = require('path');

var PORT = Number(process.env.TUBE_PROXY_PORT) || 8398;
var DEADLINE = 20000;

function fail(message) {
    process.stderr.write('FAIL  ' + message + '\n');
    process.exit(1);
}

function pass(message) {
    process.stdout.write('PASS  ' + message + '\n');
}

var scratch = path.join(os.tmpdir(), 'tube-smoke-' + process.pid + '-' + Date.now());
fs.mkdirSync(scratch);

process.on('exit', function () {
    (fs.rmSync || fs.rmdirSync)(scratch, { recursive: true, force: true });
});

process.env.TUBE_PROXY_PORT = String(PORT);
process.env.TUBE_CACHE_DIR = scratch;
process.env.TUBE_LOG = path.join(scratch, 'service.log');

// A closed loopback port, so the update check fails at once instead of reaching the network from CI.
process.env.TUBE_ORIGIN = 'http://127.0.0.1:1';

var entry = path.join(__dirname, '..', 'dist', 'index.js');

if (!fs.existsSync(entry)) fail('no bundle at ' + entry + ' — run `npm run build` first.');

try {
    require(entry);
} catch (e) {
    fail('the bundle would not load on ' + process.version + ': ' + ((e && e.stack) || e));
}

pass('the bundle loads on ' + process.version);

function get(pathname, done) {
    var request = http.get({ host: '127.0.0.1', port: PORT, path: pathname }, function (response) {
        var body = '';
        response.on('data', function (chunk) { body += chunk; });
        response.on('end', function () { done(null, response.statusCode, body); });
    });

    request.on('error', function (error) { done(error); });
    request.setTimeout(4000, function () { request.destroy(); });
}

// Every route that stays local answers even when fetch is broken, so only an upstream round trip
// proves it works.
function checkItCanFetchUpstream() {
    var upstream = http.createServer(function (request, response) {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('pong');
    });

    upstream.listen(0, '127.0.0.1', function () {
        var target = 'http://127.0.0.1:' + upstream.address().port + '/ping';

        get('/cors-bypass/' + target, function (error, status, body) {
            upstream.close();

            if (error) return fail('the proxy could not reach a local upstream: ' + error.message);

            if (status !== 200 || body !== 'pong') {
                return fail('the proxy answered ' + status + ' for an upstream it should have fetched: '
                    + String(body).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200));
            }

            pass('it can fetch upstream and hand the answer back');

            process.stdout.write('\nSmoke passed on ' + process.version + '.\n');
            return process.exit(0);
        });
    });
}

var began = Date.now();

(function waitForPort() {
    get('/__tube/state', function (error, status, body) {
        // An HTTP status means the service is up and answering badly, which is not something to
        // wait out: retrying until it settles is how a first-request failure stays invisible.
        if (!error && status !== 200) {
            fail('/__tube/state answered ' + status + ' on ' + process.version + ': '
                + String(body).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300));
        }

        if (error) {
            if (Date.now() - began > DEADLINE) {
                fail('the service never answered on port ' + PORT + ' within '
                    + (DEADLINE / 1000) + 's (' + error.message + ')');
            }

            return setTimeout(waitForPort, 250);
        }

        var state;
        try {
            state = JSON.parse(body);
        } catch (e) {
            return fail('/__tube/state did not answer JSON: ' + body.slice(0, 120));
        }

        pass('/__tube/state answers on port ' + PORT + ' after ' + (Date.now() - began) + 'ms');

        if (!state.script || typeof state.script.origin !== 'string') {
            return fail('/__tube/state reports no userscript: ' + JSON.stringify(state.script));
        }

        pass('it can serve the ' + state.script.origin + ' userscript');

        return get('/__tube/userScript.js', function (scriptError, scriptStatus, script) {
            if (scriptError || scriptStatus !== 200) {
                return fail('/__tube/userScript.js did not answer'
                    + (scriptError ? ': ' + scriptError.message : ' (status ' + scriptStatus + ')'));
            }

            if (script.length < 1000) return fail('the userscript came back as ' + script.length + ' bytes');

            pass('/__tube/userScript.js serves ' + Math.round(script.length / 1024) + 'kB');

            return checkItCanFetchUpstream();
        });
    });
})();
