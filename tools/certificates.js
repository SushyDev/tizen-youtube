'use strict';

// Where the signing certificates are. Default `~/.tizen-certs`, with the password in a
// file beside them; environment variables win where set, because CI has no home
// directory. Tizen Homebrew mints its pairs into the same directory.

const { existsSync, readFileSync } = require('fs');
const { join, dirname } = require('path');
const { homedir } = require('os');

const DEFAULT_DIR = join(homedir(), '.tizen-certs');

/**
 * The pair this machine would sign with, and where each part came from. Never throws:
 * `doctor` reports what is missing and `package` refuses with it.
 */
const locate = () => {
    const author = process.env.TIZEN_AUTHOR_P12 || join(DEFAULT_DIR, 'author.p12');
    const beside = (name) => join(dirname(author), name);

    const passwordFile = beside('author.pw');

    const password = process.env.TIZEN_AUTHOR_PW ||
        (existsSync(passwordFile) ? readFileSync(passwordFile, 'utf8').trim() : null);

    return {
        author,
        // create-samsung-cert writes both halves side by side under one password.
        distributor: process.env.TIZEN_DISTRIBUTOR_P12 || beside('distributor.p12'),
        password,
        distributorPassword: process.env.TIZEN_DISTRIBUTOR_PW || password,
        passwordFile,
        directory: DEFAULT_DIR
    };
};

/** What is missing, in the order somebody would fix it. */
const missing = (certificates) => [
    !existsSync(certificates.author) ? `no author certificate at ${certificates.author}` : null,
    !existsSync(certificates.distributor) ? `no distributor certificate at ${certificates.distributor}` : null,
    !certificates.password ? `no password — put it in ${certificates.passwordFile}, or set TIZEN_AUTHOR_PW` : null
].filter(Boolean);

/**
 * The instructions for making one, which every caller ends up printing. Minting lives
 * in Tizen Homebrew: it needs a Samsung sign-in and the television's DUID.
 */
const howToMint = () => 'Mint a pair bound to your television, from the Tizen Homebrew repository:\n\n' +
    '    git clone https://github.com/SushyDev/tizen-homebrew\n' +
    '    npm run mint -- <tv-ip>             ask the TV which device it is\n' +
    '    npm run mint -- --duid <TV-DUID>    when you already know\n\n' +
    `  Both halves land in ${DEFAULT_DIR}, which is where this repository looks.`;

module.exports = { locate, missing, howToMint, DEFAULT_DIR };
