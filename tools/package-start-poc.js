'use strict';

// Derive experimental widgets from the regular legacy release without changing its files or sources.
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const JSZip = require('jszip');
const start = require('./poc/start.js');
const { ROOT } = require('./lib/config.js');
const paths = require('./lib/paths.js');

const PREFIX = 'http://samsung.com/tv/metadata/';
const HANDOFF_PACKAGE = 'tUb3Xq7LCb';
const OUTPUT = 'release/tube-tizen-5.0-start-poc.wgt';
const HANDOFF_OUTPUT = 'release/tube-tizen-5.0-cobalt-handoff-poc.wgt';

const derive = async (bytes) => {
    const web = await JSZip.loadAsync(bytes);
    const native = await JSZip.loadAsync(bytes);
    const xml = (await web.file('config.xml').async('string'))
        .replace('metadata/prelaunch.support" value="true"', 'metadata/prelaunch.support" value="false"');
    if (!xml.includes('id="tUb3Xq7L50.Tube" package="tUb3Xq7L50" required_version="5.0"')
        || !xml.includes('<tizen:service id="tUb3Xq7L50.TubeService"')) {
        throw new Error('Expected the regular Tizen 5.0 widget; run npm run package first.');
    }
    const nativeMetadata = {};
    ['pkgid', 'nativeID', 'native.userdata'].forEach((key) => {
        const line = xml.split('\n').find((line) => line.includes(`key="${PREFIX}${key}"`));
        if (!line) throw new Error(`Missing native metadata: ${key}`);
        nativeMetadata[PREFIX + key] = /value="([^"]*)"/.exec(line)[1];
    });
    const args = nativeMetadata[PREFIX + 'native.userdata'];
    if (args !== '--base_url=http://127.0.0.2:8099/tv --dial_name=Tube --use_eden'
        || nativeMetadata[PREFIX + 'pkgid'] !== 'com.samsung.tv.cobalt'
        || nativeMetadata[PREFIX + 'nativeID'] !== 'com.samsung.tv.cobalt-yt') {
        throw new Error('PoC expects the unchanged legacy Cobalt parameters and port 8099.');
    }
    const config = {
        packageId: 'tUb3Xq7L50', appId: 'tUb3Xq7L50.Tube', serviceId: 'tUb3Xq7L50.TubeService',
        ping: 'http://127.0.0.2:8099/__tube/ping',
        handoffPackageId: HANDOFF_PACKAGE, handoffId: `${HANDOFF_PACKAGE}.TubeCobalt`,
        nativeId: nativeMetadata[PREFIX + 'nativeID'], nativeMetadata
    };
    // userdata stays as inert configuration for the unchanged service's origin.js; remove both pairing keys.
    const webXml = xml.split('\n').filter((line) => !line.includes(`key="${PREFIX}pkgid"`)
        && !line.includes(`key="${PREFIX}nativeID"`)).join('\n')
        .replace('<name>YouTube</name>', '<name>Tube Starter</name>')
        .replace('<icon src="icon.png"/>', '<icon src="icon-starter.png" width="117" height="117"/>')
        .replace('<tizen:privilege name="http://tizen.org/privilege/application.info"/>',
            '<tizen:privilege name="http://tizen.org/privilege/application.info"/>\n'
            + '    <tizen:privilege name="http://tizen.org/privilege/appmanager.kill"/>')
        .replace('background-support="disable"', 'background-support="enable"')
        .replace('metadata/devel.api.version" value="5.5"', 'metadata/devel.api.version" value="5.0"')
        .replace('auto-restart="true" on-boot="true"', 'auto-restart="false" on-boot="false"');
    web.file('config.xml', webXml);
    web.remove('icon.png');
    web.file('icon-starter.png', readFileSync(join(ROOT, 'tools/poc/icons/icon-starter.png')));
    const script = `(${start.toString()})(window, ${JSON.stringify(config)});`;
    web.file('index.html', readFileSync(join(ROOT, 'tools/poc/start.html'), 'utf8')
        .replace('__TUBE_START_POC_SCRIPT__', script));

    const nativeXml = xml.replace(/\s*<tizen:service\b[\s\S]*?<\/tizen:service>/g, '')
        .replace(/^.*feature\/web\.service.*\n/gm, '')
        .replace(/tUb3Xq7L50\.Tube/g, `${HANDOFF_PACKAGE}.TubeCobalt`)
        .replace(/package="tUb3Xq7L50"/g, `package="${HANDOFF_PACKAGE}"`)
        .replace('<name>YouTube</name>', '<name>Tube Cobalt</name>')
        .replace('<icon src="icon.png"/>', '<icon src="icon-cobalt.png" width="117" height="117"/>');
    native.file('config.xml', nativeXml);
    native.remove('icon.png');
    native.file('icon-cobalt.png', readFileSync(join(ROOT, 'tools/poc/icons/icon-cobalt.png')));
    native.remove('service');
    [web, native].forEach((zip) => Object.keys(zip.files)
        .filter((name) => /^(author-signature|signature\d+)\.xml$/.test(name))
        .forEach((name) => zip.remove(name)));
    return { web, native, config };
};

const main = async () => {
    const bytes = readFileSync(join(ROOT, paths.WGT_LEGACY));
    const { web, native } = await derive(bytes);
    const bundledService = await web.file('service/dist/index.js').async('nodebuffer');
    if (!bundledService.equals(readFileSync(join(ROOT, paths.SERVICE_BUNDLE_LEGACY)))) {
        throw new Error('Legacy widget differs from the current service build; run npm run package first.');
    }
    const options = { type: 'nodebuffer', compression: 'DEFLATE' };
    writeFileSync(join(ROOT, OUTPUT), await web.generateAsync(options));
    writeFileSync(join(ROOT, HANDOFF_OUTPUT), await native.generateAsync(options));
    console.log(`Tube Starter: ${OUTPUT}`);
    console.log(`Tube Cobalt handoff, no service: ${HANDOFF_OUTPUT}`);
    console.log('Both widgets are unsigned. The regular release widgets are unchanged.');
};

module.exports = { derive, OUTPUT, HANDOFF_OUTPUT };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
