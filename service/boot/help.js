import { journal, diag, help } from './config.js';
import { held } from './state.js';
import { say } from './screen.js';
import { phoneCanHelp } from './view.js';

// The page comes first because it names what failed and what to do; the log is its raw material.
export const sayHelp = () => {
    if (held.helped) return;
    held.helped = true;

    if (phoneCanHelp()) {
        say('tube', `scan the code on screen, or open ${diag} on a phone or computer: it says what failed and what to do`, 'note');
        say('tube', `the whole log is at ${journal}`, 'note');
    }

    say('tube', `report it at ${help.discord} or ${help.repo}`
        + (held.code ? `, with code ${held.code}` : ', with a photo of this whole screen'), 'note');
};
