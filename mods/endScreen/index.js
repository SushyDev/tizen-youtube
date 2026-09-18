import { configRead, onResponse } from '../../framework/index.js';

onResponse('end screen', ['endscreen'], (r) => {
    if (r.endscreen && configRead('enableHideEndScreenCards')) r.endscreen = null;
});
