import { configRead, onResponse } from '../../framework/index.js';

// "Are you still watching?" — the prompt that stops playback after a long run.

onResponse('are you still watching', ['messages'], (r) => {
    if (!Array.isArray(r.messages) || configRead('enableYouThereRenderer')) return;

    r.messages = r.messages.filter((message) => !message?.youThereRenderer);
});
