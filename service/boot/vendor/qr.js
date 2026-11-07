// Byte-mode QR encoder for short URLs, versions 1 to 9, after Project Nayuki's reference (MIT).

const LEVEL = {
    L: { bits: 1, ecc: [7, 10, 15, 20, 26, 18, 20, 24, 30], blocks: [1, 1, 1, 1, 1, 2, 2, 2, 2] },
    M: { bits: 0, ecc: [10, 16, 26, 18, 24, 16, 18, 22, 22], blocks: [1, 1, 1, 2, 2, 4, 4, 4, 5] }
};

const MAX_VERSION = 9;

const bytesOf = (text) => {
    const utf8 = unescape(encodeURIComponent(text));
    const out = [];
    for (let i = 0; i < utf8.length; i++) out.push(utf8.charCodeAt(i));
    return out;
};

const rawModules = (version) => {
    let result = (16 * version + 128) * version + 64;

    if (version >= 2) {
        const align = Math.floor(version / 7) + 2;
        result -= (25 * align - 10) * align - 55;
        if (version >= 7) result -= 36;
    }

    return result;
};

const dataCodewords = (version, level) =>
    Math.floor(rawModules(version) / 8) - level.ecc[version - 1] * level.blocks[version - 1];

const multiply = (x, y) => {
    let z = 0;

    for (let i = 7; i >= 0; i--) {
        z = (z << 1) ^ ((z >>> 7) * 0x11d);
        z ^= ((y >>> i) & 1) * x;
    }

    return z;
};

const divisor = (degree) => {
    const result = [];
    for (let i = 0; i < degree - 1; i++) result.push(0);
    result.push(1);

    let root = 1;

    for (let i = 0; i < degree; i++) {
        for (let j = 0; j < degree; j++) {
            result[j] = multiply(result[j], root);
            if (j + 1 < degree) result[j] ^= result[j + 1];
        }

        root = multiply(root, 0x02);
    }

    return result;
};

const remainder = (data, by) => {
    const result = by.map(() => 0);

    data.forEach((byte) => {
        const factor = byte ^ result.shift();
        result.push(0);
        by.forEach((coefficient, i) => { result[i] ^= multiply(coefficient, factor); });
    });

    return result;
};

const interleave = (data, version, level) => {
    const blocks = level.blocks[version - 1];
    const eccLength = level.ecc[version - 1];
    const raw = Math.floor(rawModules(version) / 8);
    const short = blocks - (raw % blocks);
    const shortLength = Math.floor(raw / blocks);
    const by = divisor(eccLength);

    const filled = [];

    for (let i = 0, k = 0; i < blocks; i++) {
        const block = data.slice(k, k + shortLength - eccLength + (i < short ? 0 : 1));
        k += block.length;

        const ecc = remainder(block, by);
        if (i < short) block.push(0);

        filled.push(block.concat(ecc));
    }

    const result = [];

    for (let i = 0; i < filled[0].length; i++) {
        filled.forEach((block, j) => {
            if (i !== shortLength - eccLength || j >= short) result.push(block[i]);
        });
    }

    return result;
};

const codewords = (bytes, version, level) => {
    const bits = [];
    const put = (value, length) => {
        for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
    };

    put(4, 4);
    put(bytes.length, version < 10 ? 8 : 16);
    bytes.forEach((byte) => put(byte, 8));

    const capacity = dataCodewords(version, level) * 8;

    put(0, Math.min(4, capacity - bits.length));
    put(0, (8 - (bits.length % 8)) % 8);

    for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);

    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));

    return interleave(data, version, level);
};

const alignments = (version) => {
    if (version === 1) return [];

    const count = Math.floor(version / 7) + 2;
    const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    const result = [6];

    for (let position = version * 4 + 10; result.length < count; position -= step) result.splice(1, 0, position);

    return result;
};

const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
];

const grid = (size, value) => {
    const rows = [];

    for (let y = 0; y < size; y++) {
        const row = [];
        for (let x = 0; x < size; x++) row.push(value);
        rows.push(row);
    }

    return rows;
};

const layout = (version, level, data, mask) => {
    const size = version * 4 + 17;
    const modules = grid(size, false);
    const reserved = grid(size, false);

    const set = (x, y, dark) => {
        modules[y][x] = dark;
        reserved[y][x] = true;
    };

    for (let i = 0; i < size; i++) {
        set(6, i, i % 2 === 0);
        set(i, 6, i % 2 === 0);
    }

    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
        for (let dy = -4; dy <= 4; dy++) {
            for (let dx = -4; dx <= 4; dx++) {
                const distance = Math.max(Math.abs(dx), Math.abs(dy));
                const x = cx + dx;
                const y = cy + dy;
                if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
            }
        }
    });

    const centres = alignments(version);
    const last = centres.length - 1;

    centres.forEach((cx, i) => centres.forEach((cy, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;

        for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
    }));

    const format = (level.bits << 3) | mask;
    let rem = format;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const formatBits = ((format << 10) | rem) ^ 0x5412;
    const fbit = (i) => ((formatBits >>> i) & 1) !== 0;

    for (let i = 0; i <= 5; i++) set(8, i, fbit(i));
    set(8, 7, fbit(6));
    set(8, 8, fbit(7));
    set(7, 8, fbit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, fbit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fbit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, fbit(i));
    set(8, size - 8, true);

    if (version >= 7) {
        let vrem = version;
        for (let i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1f25);
        const versionBits = (version << 12) | vrem;

        for (let i = 0; i < 18; i++) {
            const dark = ((versionBits >>> i) & 1) !== 0;
            const a = size - 11 + (i % 3);
            const b = Math.floor(i / 3);
            set(a, b, dark);
            set(b, a, dark);
        }
    }

    let bit = 0;

    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;

        for (let vertical = 0; vertical < size; vertical++) {
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                const upward = ((right + 1) & 2) === 0;
                const y = upward ? size - 1 - vertical : vertical;

                if (!reserved[y][x] && bit < data.length * 8) {
                    modules[y][x] = ((data[bit >>> 3] >>> (7 - (bit & 7))) & 1) !== 0;
                    bit++;
                }
            }
        }
    }

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
        }
    }

    return modules;
};

const FINDER = [true, false, true, true, true, false, true];

const penalty = (modules) => {
    const size = modules.length;
    let score = 0;
    let dark = 0;

    const line = (get) => {
        let run = 1;

        for (let i = 1; i <= size; i++) {
            if (i < size && get(i) === get(i - 1)) {
                run++;
            } else {
                if (run >= 5) score += run - 2;
                run = 1;
            }
        }

        for (let i = 0; i + 7 <= size; i++) {
            if (!FINDER.every((value, k) => get(i + k) === value)) continue;

            const light = (from, to) => {
                for (let k = from; k < to; k++) if (k >= 0 && k < size && get(k)) return false;
                return true;
            };

            if (light(i - 4, i) || light(i + 7, i + 11)) score += 40;
        }
    };

    for (let y = 0; y < size; y++) line((x) => modules[y][x]);
    for (let x = 0; x < size; x++) line((y) => modules[y][x]);

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (modules[y][x]) dark++;

            if (x + 1 < size && y + 1 < size) {
                const c = modules[y][x];
                if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
            }
        }
    }

    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;

    return score;
};

// Rows of booleans, true for a dark module, without the quiet zone.
const encode = (text, levelName) => {
    const level = LEVEL[levelName || 'M'];
    const bytes = bytesOf(text);

    let version = 1;
    while (version <= MAX_VERSION && dataCodewords(version, level) * 8 < 12 + bytes.length * 8) version++;
    if (version > MAX_VERSION) throw new Error('too long for a QR code');

    const data = codewords(bytes, version, level);

    let best = null;
    let bestScore = Infinity;

    for (let mask = 0; mask < 8; mask++) {
        const candidate = layout(version, level, data, mask);
        const score = penalty(candidate);

        if (score < bestScore) {
            best = candidate;
            bestScore = score;
        }
    }

    return best;
};

export { encode };
