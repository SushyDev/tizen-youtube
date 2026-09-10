import { ROWS, claimActionRows, claimBooleanRows } from './settingComponents.js';
import { claimVersionPanel } from './aboutPatch.js';

// Catching the rows once they are drawn.
//
// The response is patched long before any of it reaches the DOM — the action row's own code is
// fetched only when the first one is drawn — so this keeps looking rather than trying once. It
// eases off after five seconds and gives up entirely once the settings page is gone, so a viewer
// who opened settings and left does not leave a timer running for the life of the page.

const SETTLING_ATTEMPTS = 20;
const SETTLING_EVERY = 250;
const PATIENT_EVERY = 500;
const PATIENT_ATTEMPTS = 120;

const claimDrawnRows = (attempt = 0) => {
    const claimed = claimBooleanRows();
    const annotated = claimActionRows();
    const stamped = claimVersionPanel();
    if (claimed && annotated && stamped) return;

    const settling = attempt < SETTLING_ATTEMPTS;
    if (!settling && !document.querySelector(ROWS)) return;
    if (attempt >= SETTLING_ATTEMPTS + PATIENT_ATTEMPTS) return;

    setTimeout(() => claimDrawnRows(attempt + 1), settling ? SETTLING_EVERY : PATIENT_EVERY);
};

export { claimDrawnRows };
