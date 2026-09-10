import { configRead, onResponse } from '../../framework/index.js';

// YouTube's "Includes paid promotion" badge.
//
// Whether the container ever sends this is unsettled: paidContentOverlay appears nowhere in the
// app's own code, but a response field need not, and only a video that carries a disclosure would
// prove it either way. Left in place until one does.

onResponse('paid promotion', ['paidContentOverlay'], (r) => {
    if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) r.paidContentOverlay = null;
});
