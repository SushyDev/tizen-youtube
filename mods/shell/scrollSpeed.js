import { answerSwitch, configRead } from '../../framework/index.js';

// Answers YouTube's list-duration switches with the chosen rung, each solved from
// speed = (stock + 81) / (duration + 81).

const SPEEDS = {
    '1.25': { vertical: 224, horizontal: 144 },
    '1.5': { vertical: 173, horizontal: 106 },
    '2': { vertical: 110, horizontal: 60 },
    '2.5': { vertical: 71, horizontal: 31 },
    '3': { vertical: 46, horizontal: 13 }
};

const SWITCHES = [
    { name: 'verticalListDurationMs', rung: 'vertical' },
    { name: 'horizontalListDurationMs', rung: 'horizontal' }
];

const chosen = () => SPEEDS[configRead('scrollSpeed')] || null;

const start = () => SWITCHES.forEach((one) => answerSwitch(one.name, () => {
    const speed = chosen();
    return speed ? speed[one.rung] : undefined;
}));

export { start, SPEEDS };
