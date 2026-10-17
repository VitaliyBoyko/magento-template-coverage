'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Build the same small CommonJS runtime used by Cypress into one init script.
// No parser, Node dependency or external bundler is shipped to the browser.
function browserSource() {
    const files = ['engines-runtime', 'execution', 'browser'];
    const modules = files.map(name => `${JSON.stringify(`./${name}`)}: function(module, exports, require) {\n${fs.readFileSync(path.join(__dirname, `${name}.js`), 'utf8')}\n}`);
    return `(() => { const modules = {${modules.join(',')}}; const cache = {}; function require(name) { if (!cache[name]) { const module = cache[name] = {exports:{}}; modules[name](module, module.exports, require); } return cache[name].exports; } return require('./browser'); })()`;
}

module.exports = { browserSource };
