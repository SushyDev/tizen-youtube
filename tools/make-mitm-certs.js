'use strict';

// Generates local-only certificates for the opt-in Cobalt MITM experiment. The output directory is
// intentionally ignored by git; the private key must never be packaged into the widget.
const { execFileSync } = require('child_process');
const { mkdirSync, writeFileSync, readFileSync } = require('fs');
const { join } = require('path');

const out = process.env.TUBE_MITM_OUT || join(__dirname, '..', '.dev', 'mitm');
mkdirSync(out, { recursive: true });

const run = (args) => execFileSync('openssl', args, { stdio: 'inherit' });
const ca = join(out, 'ca');
const leaf = join(out, 'leaf');
const ext = join(out, 'leaf.ext');

writeFileSync(ext, [
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth',
    'subjectAltName=DNS:youtube.com,DNS:*.youtube.com,DNS:googlevideo.com,DNS:*.googlevideo.com,DNS:googleapis.com,DNS:*.googleapis.com,DNS:google.com,DNS:*.google.com,DNS:gstatic.com,DNS:*.gstatic.com,DNS:ggpht.com,DNS:*.ggpht.com'
].join('\n'));
run(['genrsa', '-out', `${ca}.key`, '4096']);
run(['req', '-x509', '-new', '-nodes', '-key', `${ca}.key`, '-sha384', '-days', '3650',
    '-subj', '/CN=Tube Cobalt Experiment CA', '-out', `${ca}.crt`,
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    '-addext', 'subjectKeyIdentifier=hash']);
run(['genrsa', '-out', `${leaf}.key`, '2048']);
run(['req', '-new', '-key', `${leaf}.key`, '-subj', '/CN=www.youtube.com', '-out', `${leaf}.csr`]);
run(['x509', '-req', '-in', `${leaf}.csr`, '-CA', `${ca}.crt`, '-CAkey', `${ca}.key`,
    // 397 days, not 825: Chromium's verifier rejects a longer-lived leaf outright, and Cobalt has
    // no notion of a locally added root that would exempt one.
    '-CAcreateserial', '-out', `${leaf}.crt`, '-days', '397', '-sha256', '-extfile', ext]);
writeFileSync(`${leaf}-chain.crt`, `${readFileSync(`${leaf}.crt`)}${readFileSync(`${ca}.crt`)}`);

const hash = execFileSync('openssl', ['x509', '-subject_hash_old', '-in', `${ca}.crt`], { encoding: 'utf8' })
    .split('\n')[0].trim();
writeFileSync(join(out, 'ca.hash'), `${hash}.0\n`);
console.log(JSON.stringify({ out, ca: `${ca}.crt`, caHash: `${hash}.0`, key: `${leaf}.key`, cert: `${leaf}-chain.crt` }));
