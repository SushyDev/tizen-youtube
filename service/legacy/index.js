'use strict';

require('core-js/stable');
require('./buffer.js');
require('./fs.js');
require('./normalize.js');
// Tizen's service runner reads its handlers from this module's exports.
module.exports = require('../index.js');
