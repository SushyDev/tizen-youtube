import { ROWS, claimActionRows, claimBooleanRows } from './settingComponents.js';
import { claimVersionPanel } from './aboutPatch.js';

// Claims drawn rows every 250ms for 5s, then every 500ms while the settings page is open.

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
