'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const COBALT = '/usr/apps/com.samsung.tv.cobalt';
const MOST_LISTED = 150;
const CHUNK = 8 * 1024 * 1024;

const safe = (read) => {
    try {
        return read();
    } catch (e) {
        return `unreadable: ${e.code || e.message}`;
    }
};

const text = (file, limit) => safe(() => fs.readFileSync(file, 'utf8').slice(0, limit || 4000));

const listing = (dir, depth) => safe(() => fs.readdirSync(dir).slice(0, MOST_LISTED).map((name) => {
    const full = path.join(dir, name);
    const stat = safe(() => fs.statSync(full));

    if (typeof stat === 'string') return `${name} (${stat})`;
    if (!stat.isDirectory()) return `${name} ${stat.size}`;

    return depth > 0 ? { [`${name}/`]: listing(full, depth - 1) } : `${name}/`;
}));

const filesUnder = (dir, depth) => safe(() => fs.readdirSync(dir).reduce((found, name) => {
    const full = path.join(dir, name);
    const stat = safe(() => fs.statSync(full));

    if (typeof stat === 'string') return found;
    if (stat.isDirectory()) return depth > 0 ? found.concat(listOf(filesUnder(full, depth - 1))) : found;

    return found.concat([{ file: full, size: stat.size }]);
}, []));

// safe() answers a string when it cannot read, and an unreadable folder holds nothing to list.
const listOf = (value) => (Array.isArray(value) ? value : []);

const writable = (dir) => safe(() => {
    const probe = path.join(dir, `.tube-probe-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
});

const OVERLAP = 64;

// One chunk at a time, overlapping so a name split across two chunks is still seen.
const scan = (reader, needles, found, at) => {
    if (at >= reader.size) return found;

    const read = fs.readSync(reader.fd, reader.buffer, 0, Math.min(CHUNK + OVERLAP, reader.size - at), at);
    const window = reader.buffer.slice(0, read);
    const seen = needles
        .filter((needle) => found.indexOf(needle.name) === -1 && window.indexOf(needle.bytes) !== -1)
        .map((needle) => needle.name);

    return scan(reader, needles, found.concat(seen), at + CHUNK);
};

const contains = (file, names) => safe(() => {
    const fd = fs.openSync(file, 'r');
    const reader = {
        fd,
        size: fs.fstatSync(fd).size,
        buffer: Buffer.alloc ? Buffer.alloc(CHUNK + OVERLAP) : new Buffer(CHUNK + OVERLAP)
    };
    const needles = names.map((name) => ({ name, bytes: Buffer.from(name, 'utf8') }));
    const found = scan(reader, needles, [], 0);

    fs.closeSync(fd);
    return { size: reader.size, present: found, absent: names.filter((name) => found.indexOf(name) === -1) };
});

const TIZEN_KEYS = [
    'http://tizen.org/feature/platform.version',
    'http://tizen.org/system/platform.name',
    'http://tizen.org/system/model_name',
    'http://tizen.org/system/build.string',
    'http://tizen.org/system/build.date',
    'http://tizen.org/system/build.type',
    'http://tizen.org/feature/screen.width',
    'http://tizen.org/feature/screen.height',
    'http://tizen.org/feature/platform.core.cpu.arch',
    'http://tizen.org/feature/platform.core.fpu.arch',
    'http://tizen.org/feature/platform.native.api.version',
    'http://tizen.org/feature/platform.web.api.version',
    'http://tizen.org/feature/network.ethernet',
    'http://tizen.org/feature/network.wifi'
];

const tizenFacts = () => {
    const tizen = global.tizen;
    if (!tizen) return 'no tizen global';

    return {
        apis: Object.keys(tizen),
        capabilities: TIZEN_KEYS.reduce((out, key) => Object.assign(out, {
            [key.replace('http://tizen.org/', '')]: safe(() => tizen.systeminfo.getCapability(key))
        }), {}),
        memory: safe(() => ({
            total: Math.round(tizen.systeminfo.getTotalMemory() / 1048576),
            available: Math.round(tizen.systeminfo.getAvailableMemory() / 1048576)
        })),
        app: safe(() => {
            const info = tizen.application.getAppInfo();
            return { id: info.id, version: info.version, packageId: info.packageId };
        }),
        webapis: typeof global.webapis
    };
};

const survey = (switches) => {
    const engine = listOf(filesUnder(COBALT, 4))
        .filter((entry) => entry.size > 5 * 1024 * 1024)
        .sort((a, b) => b.size - a.size)
        .slice(0, 2);

    return {
        node: {
            versions: process.versions,
            arch: process.arch,
            platform: process.platform,
            execPath: process.execPath,
            release: process.release,
            features: process.features,
            config: process.config && process.config.variables
        },
        os: {
            type: os.type(),
            release: os.release(),
            hostname: os.hostname(),
            uptime: os.uptime(),
            loadavg: os.loadavg(),
            totalmem: Math.round(os.totalmem() / 1048576),
            freemem: Math.round(os.freemem() / 1048576),
            cpus: os.cpus().map((cpu) => `${cpu.model} ${cpu.speed}`),
            interfaces: safe(() => Object.keys(os.networkInterfaces()))
        },
        process: {
            pid: process.pid,
            uid: safe(() => process.getuid()),
            gid: safe(() => process.getgid()),
            cwd: process.cwd(),
            argv: process.argv,
            memory: process.memoryUsage(),
            env: Object.keys(process.env).sort()
        },
        proc: {
            version: text('/proc/version'),
            cpuinfo: text('/proc/cpuinfo', 3000),
            meminfo: text('/proc/meminfo', 1500),
            limits: text('/proc/self/limits'),
            status: text('/proc/self/status', 2000),
            mounts: text('/proc/mounts', 6000)
        },
        release: { tizen: text('/etc/tizen-release'), os: text('/etc/os-release'), info: text('/etc/info.ini') },
        tizen: tizenFacts(),
        writable: [
            '/home/owner/share/tube', '/home/owner/share', '/home/owner/share/tmp/sdk_tools', '/tmp',
            '/opt/usr/home/owner', path.resolve(__dirname, '..', '..')
        ].reduce((out, dir) => Object.assign(out, { [dir]: writable(dir) }), {}),
        listings: {
            cobalt: listing(COBALT, 3),
            ours: listing(path.resolve(__dirname, '..', '..', '..'), 2),
            share: listing('/home/owner/share', 1),
            usrApps: listing('/usr/apps', 0),
            optApps: listing('/opt/usr/apps', 0)
        },
        engine: engine.map((entry) => Object.assign({}, entry, {
            switches: Array.isArray(switches) && switches.length ? contains(entry.file, switches) : 'no switches asked'
        }))
    };
};

module.exports = { survey };
