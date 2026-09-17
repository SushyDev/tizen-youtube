import { journal, help } from './config.js';
import { held } from './state.js';
import { say } from './screen.js';

// Said once, when the screen has given up on its own.
export const sayHelp = () => {
    if (held.helped) return;
    held.helped = true;

    say('tube', `open ${journal} on a phone or computer to read the whole log`, 'note');
    say('tube', `report what it says at ${help.discord} or ${help.repo}`, 'note');
};
