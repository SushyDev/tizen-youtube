import { PIVOT, SHELF, configRead, keepShelf } from '../../framework/index.js';

const wanted = () => configRead('enableSigninReminder');

keepShelf('sign-in nudges', [SHELF, PIVOT], (entry) =>
    wanted() || (!entry.feedNudgeRenderer && !entry.alertWithActionsRenderer));
