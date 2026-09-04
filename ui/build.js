import { readFileSync } from 'fs';
import { build } from 'vite';
import { unsupportedCss, stylesOf } from '../tools/css-support.js';

await build();

const problems = unsupportedCss(stylesOf(readFileSync('dist/index.html', 'utf8')));

if (problems.length > 0) {
    console.error([
        '',
        'This CSS would not render on the television.',
        '',
        ...problems.map((problem) => `  index.html: ${problem}`),
        '',
        'Tizen 6.5 is Chromium 76 and drops what it cannot parse without a word.',
        'Either write it another way, or teach PostCSS to lower it in vite.config.js.',
        ''
    ].join('\n'));

    process.exit(1);
}

console.log('\nchecked the boot screen against Chromium 63 — nothing the TV would drop\n');
