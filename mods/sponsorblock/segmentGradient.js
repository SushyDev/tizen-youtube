import { SEGMENTS } from './segments.js';

const POINT_WIDTH = 0.4;

const barFor = (segment) => SEGMENTS[segment.category] || { color: '#0000ff', opacity: 0.7 };

const rgba = (hex, opacity) => {
    const found = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
    if (!found) return hex;

    const channels = [found[1], found[2], found[3]].map((pair) => parseInt(pair, 16));
    return `rgba(${channels.join(', ')}, ${opacity})`;
};

const stretches = (segments, duration) => segments
    .map((segment) => {
        const bar = barFor(segment);

        return {
            colour: rgba(bar.color, bar.opacity),
            from: segment.segment[0],
            to: segment.category === 'poi_highlight'
                ? segment.segment[0] + (duration * POINT_WIDTH) / 100
                : segment.segment[1]
        };
    })
    .filter((stretch) => stretch.to > stretch.from)
    .sort((one, two) => one.from - two.from);

// Overlapping stretches rely on CSS clamping a stop that would run backwards.
const gradientOver = (all, span) => {
    const across = span.to - span.from;
    if (!(across > 0)) return '';

    const stops = all.reduce((kept, stretch) => {
        const from = ((stretch.from - span.from) / across) * 100;
        const to = ((stretch.to - span.from) / across) * 100;

        if (to <= 0 || from >= 100) return kept;

        const left = Math.max(0, from);
        const right = Math.min(100, to);

        return kept.concat([
            `transparent ${left}%`, `${stretch.colour} ${left}%`,
            `${stretch.colour} ${right}%`, `transparent ${right}%`
        ]);
    }, []);

    return stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : '';
};

export { stretches, gradientOver };
