import { held } from './state.js';
import { say } from './screen.js';

const showOnce = (facts) => {
    if (held.facts) return;
    held.facts = true;

    say('tube', `patch ${facts.patch}`, 'note');
    say('platform', `tizen ${facts.tizen || '?'}${facts.model ? `, ${facts.model}` : ''}`);
    say('service', `node ${facts.node}, pid ${facts.pid}`);

    if (!facts.script) return;
    say('userscript', facts.script.error || `${Math.round(facts.script.bytes / 1024)}kB`, facts.script.error ? 'bad' : '');
};

export const showFacts = (facts) => {
    if (!facts) return;

    if (held.pid && facts.pid !== held.pid) say('service', `restarted: pid ${held.pid} is now pid ${facts.pid}`, 'bad');
    held.pid = facts.pid;

    showOnce(facts);
};
