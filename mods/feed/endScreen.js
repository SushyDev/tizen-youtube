import { configRead, onResponse } from '../../framework/index.js';

// The tiles an uploader lays over the last seconds of their own video.

onResponse('end screen', ['endscreen'], (r) => {
    if (r.endscreen && configRead('enableHideEndScreenCards')) r.endscreen = null;
});
