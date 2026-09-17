'use strict';

// A file is never replaced, because the Cobalt running now keeps its own.

const fs = require('fs');
const path = require('path');

const exists = (file) => {
    try {
        fs.statSync(file);
        return true;
    } catch (e) {
        return false;
    }
};

// A package names files inside content/ only.
const inside = (name) => !path.isAbsolute(name) && path.normalize(name).split(path.sep)[0] !== '..';

// Renamed into place, so a Cobalt starting meanwhile never reads half a file.
const place = (file, data) => {
    const staged = `${file}.${process.pid}`;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(staged, data);
    fs.renameSync(staged, file);
};

const merge = (content, files) => files
    .filter((file) => inside(file.name) && !exists(path.join(content, file.name)))
    .map((file) => {
        place(path.join(content, file.name), file.data);
        return file.name;
    });

module.exports = { merge };
