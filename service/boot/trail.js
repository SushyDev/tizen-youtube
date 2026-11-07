import { ago } from './clock.js';

// Written by the service into trail.js beside this page, and absent until it has run once.
export const trail = Array.isArray(window.TUBE_TRAIL) ? window.TUBE_TRAIL : [];

export const lastRun = () => trail[trail.length - 1] || null;

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const steps = (run) => run.reached.map((one) => (one.after ? `${one.stage} +${seconds(one.after)}` : one.stage)).join(' → ');

const woken = (run) => {
    const control = run.control;
    if (!control || typeof control !== 'object') return '';

    return `, woken by ${control.caller || 'the platform'}${control.operation ? ` (${control.operation.split('/').pop()})` : ''}`;
};

export const describeRun = (run) => `started ${ago(run.at)} ago, ${run.uptime}s after the TV booted, pid ${run.pid}`
    + `${woken(run)}: ${steps(run)}; `
    + `${run.ended ? `ended after ${seconds(run.ended.after)}, ${run.ended.how}` : 'no ending recorded, so it is still running or the TV stopped it'}`;

// One sentence for the card when the service is silent.
export const lastRunSays = () => {
    const run = lastRun();
    if (!run) return '';

    if (run.ended && run.ended.how.indexOf('crashed') === 0) return `The last time it ran, ${ago(run.at)} ago, it ${run.ended.how}.`;
    if (run.ended) return `It last ran ${ago(run.at)} ago and stopped with ${run.ended.how}.`;

    return `It last started ${ago(run.at)} ago and got as far as "${run.reached[run.reached.length - 1].stage}".`;
};
