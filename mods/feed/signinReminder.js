import { PIVOT, SHELF, configRead, keepShelf } from '../../framework/index.js';

// The prompt asking a signed-out viewer to sign in. It arrives in two places under two names — a
// nudge among the shelves of a feed, and an alert above the watch page — and both are entries of a
// section list, so both are answered by the walk rather than by descending to them by hand. The
// hand-rolled descent named the browse surface only, so a refreshed feed kept its nudge.

const wanted = () => configRead('enableSigninReminder');

keepShelf('sign-in nudges', [SHELF, PIVOT], (entry) =>
    wanted() || (!entry.feedNudgeRenderer && !entry.alertWithActionsRenderer));
