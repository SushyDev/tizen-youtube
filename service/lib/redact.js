'use strict';

// Query strings carry the viewer's identity (gaia ids, ip=, cpn, lounge ids), so logs keep only the path.
const withoutQuery = (url) => String(url || '').replace(/[?#].*$/, '');

const QUERIES = /(\b(?:https?:\/\/|\/)[^\s?#"']*)\?[^\s"']*/g;
const SECRETS = /\b(token|key|sig|signature|auth|authorization|cookie|sapisid|pot|cpn|ip|id|pin|password|secret)(["']?\s*[:=]\s*["']?)[^\s"',&;]+/gi;

const redact = (text) => String(text === undefined || text === null ? '' : text)
    .replace(QUERIES, '$1?…')
    .replace(SECRETS, '$1$2…');

module.exports = { withoutQuery, redact };
