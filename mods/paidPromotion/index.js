import { configRead, onResponse } from '../../framework/index.js';

// TODO: remove if the container never sends paidContentOverlay.

onResponse('paid promotion', ['paidContentOverlay'], (r) => {
    if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) r.paidContentOverlay = null;
});
