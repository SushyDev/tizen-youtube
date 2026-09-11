import { PIVOT, SHELF, configRead, keepShelf } from '../../framework/index.js';

// The sign-in nudge and alert, dropped unless enableSigninReminder.

const wanted = () => configRead('enableSigninReminder');

keepShelf('sign-in nudges', [SHELF, PIVOT], (entry) =>
    wanted() || (!entry.feedNudgeRenderer && !entry.alertWithActionsRenderer));
