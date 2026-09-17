import { journal, diag, help } from './config.js';
import { held } from './state.js';
import { say } from './screen.js';

// Said once, when the screen has given up on its own. The page first: it names what failed and what
// to do about it, where the log is the raw material behind it.
export const sayHelp = () => {
    if (held.helped) return;
    held.helped = true;

    say('tube', `open ${diag} on a phone or computer: it says what failed and what to do`, 'note');
    say('tube', `the whole log is at ${journal}`, 'note');
    say('tube', `report what it says at ${help.discord} or ${help.repo}`, 'note');
};
