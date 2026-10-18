'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const policy = "default-src 'self'; script-src 'self' 'nonce-mtc-fixture'; object-src 'none'";
const html = `<section x-data="cspFixture" x-init="initialize">
<input id="name" x-model="nameModel"><output id="echo" x-text="name"></output>
<button id="increment" @click="increment">Increment</button><output id="count" x-text="count"></output>
<button id="async" @click="asyncIncrement">Async</button><output id="initialized" x-text="initialized"></output>
<template x-for="item in items" :key="item.id"><span class="item" x-text="item.label"></span></template>
<template x-if="open"><span id="never" x-text="neverLabel"></span></template>
<button id="unused" @click="unused">Unused</button>
<template id="dynamic"><span id="inserted" x-text="name"></span></template>
<button id="insert" @click="insert">Insert</button>
</section>
<script nonce="mtc-fixture">
document.addEventListener('alpine:init', () => {
    Alpine.data('cspFixture', () => ({
        name: 'initial', count: 0, initialized: '', open: false, neverLabel: 'unused',
        items: [{id: 1, label: 'one'}, {id: 2, label: 'two'}],
        nameModel: {get() { return this.name; }, set(value) { this.name = value; }},
        init() {
            this.nameModel = {get: () => this.name, set: value => {this.name = value;}};
        },
        initialize() { this.initialized = 'ready'; },
        increment(event) { if (event.target.id === 'increment') this.count++; },
        async asyncIncrement() { await Promise.resolve(); this.count++; },
        insert() { this.$root.append(this.$root.querySelector('#dynamic').content.cloneNode(true)); },
        unused() { throw new Error('Unvisited CSP function'); }
    }));
});
</script>`;
function write(directory) {
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(path.join(directory, 'csp.html'), html);
}
function serve(req, res, copy) {
    if (req.url === '/alpine-csp.js') {
        res.setHeader('Content-Type', 'application/javascript');
        res.end(fs.readFileSync(require.resolve('@alpinejs/csp').replace(/module.cjs.js$/, 'cdn.js'))); return true;
    }
    if (['/csp.html', '/csp-baseline.html'].includes(req.url)) {
        res.setHeader('Content-Type', 'text/html'); res.setHeader('Content-Security-Policy', policy);
        const body = req.url === '/csp.html' ? fs.readFileSync(path.join(copy, 'csp.html'), 'utf8') : html;
        res.end('<!doctype html><html><head><script defer src="/alpine-csp.js"></script></head><body>' + body + '</body></html>'); return true;
    }
    return false;
}
function verify(manifest, records) {
    const entry = manifest.templates.find(entry => entry.path.endsWith('/csp.html'));
    const hits = records.reduce((result, record) => {
        for (const [id, count] of Object.entries(record.hits[entry.id] || {})) result[id] = (result[id] || 0) + count;
        return result;
    }, {});
    for (const statement of entry.statements.filter(statement => statement.syntax.startsWith('alpine:'))) {
        const unused = (statement.binding === 'x-text' && /id="never"/.test(entry.source.split('\n')[statement.start.line - 1])) || statement.binding === '@click' && /id="unused"/.test(entry.source.split('\n')[statement.start.line - 1]);
        assert.equal((hits[statement.id] || 0) > 0, !unused, `CSP binding: ${JSON.stringify(statement)}`);
    }
    return entry;
}
module.exports = {write, serve, verify, policy};
