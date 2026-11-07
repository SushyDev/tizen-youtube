const QUERIES = /(\b(?:https?:\/\/|\/)[^\s?#"']*)\?[^\s"']*/g;
const SECRETS = /\b(token|key|sig|signature|auth|authorization|cookie|sapisid|pot|cpn|ip|id|pin|password|secret)(["']?\s*[:=]\s*["']?)[^\s"',&;]+/gi;

// Query strings carry the viewer's identity, so a report keeps only the path.
export const redact = (text) => String(text === undefined || text === null ? '' : text)
    .replace(QUERIES, '$1?…')
    .replace(SECRETS, '$1$2…');
