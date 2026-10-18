"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {createManifest, instrument, merge, writeReport} = require('../lib');

test('HTML and PHTML script maps merge with bindings in one file report, retaining zeros and rejecting stale maps', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-script-report-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const source = path.join(root, 'src'), copy = path.join(root, 'copy');
    fs.mkdirSync(path.join(source, 'app/code'), {recursive: true});
    const body = `<div data-bind="text: name" x-data="{}" x-text="'hello'"></div>
<script>
function choose(enabled) { if(enabled) return 'yes'; return 'no'; }
window.value = choose(true);
</script>
<script>window.second = 2;</script>
<template><script>window.never = true;</script></template>`;
    for (const name of ['view.html', 'view.phtml']) fs.writeFileSync(path.join(source, 'app/code', name), body);
    fs.writeFileSync(path.join(source, 'app/code/app.js'), 'window.external = true;');
    const manifest = createManifest({source, roots: ['app/code']});
    assert.equal(manifest.templates.length, 2);
    instrument({source, manifest, mappings: {'app/code': copy}});
    const entry = manifest.templates.find(entry => entry.path.endsWith('.phtml'));
    assert.equal(entry.scripts.length, 3);
    assert.ok(entry.branches.every(item => Number.isInteger(item.start.line) && Number.isInteger(item.end.line)));
    assert.ok(entry.branches.some(item => item.implicit));
    assert.deepEqual(entry.statements.slice(0, 3).map(s => s.syntax), ['data-bind', 'alpine:data', 'alpine:text']);
    const counters = {};
    const window = {__mtcTemplateHit(id, key) {assert.equal(id, entry.id); counters[key] = (counters[key] || 0) + 1;}};
    const context = vm.createContext({window});
    const output = fs.readFileSync(path.join(copy, 'view.phtml'), 'utf8');
    for (const match of output.split('<template>')[0].matchAll(/<script>([\s\S]*?)<\/script>/g)) vm.runInContext(match[1], context);
    assert.equal(window.value, 'yes');
    assert.equal(window.__coverage__, undefined);
    const record = {schemaVersion: 2, recordId: 'one', ids: [entry.id], hits: {[entry.id]: counters}};
    const report = merge(manifest, [record, record]);
    assert.equal(report.records, 1);
    assert.equal(report.scripts.instrumented, 6);
    assert.equal(report.functions.covered, 1);
    assert.equal(report.branches.covered, 1);
    assert.equal(report.templates.find(item => item.path.endsWith('.html')).statementSummary.covered, 0);
    assert.equal(report.templates.find(item => item.id === entry.id).statements.find(s => s.id === 'script:3:s:0').hits, 0);
    const altered = structuredClone(manifest); altered.templates[0].functions[0].start.line++;
    assert.throws(() => merge(altered, []), /Invalid template source or statement map/);
    assert.throws(() => merge(manifest, [{...record, hits: {[entry.id]: {'script:99:f:0': 1}}}]), /Invalid statement hit/);
    writeReport(report, path.join(root, 'report'));
    const html = fs.readFileSync(path.join(root, 'report/files', entry.id + '.html'), 'utf8');
    assert.match(html, /Inline script functions and branches/);
    assert.match(html, /inline-script/);
    assert.match(html, /Branch alternative/);
});

test('script strings cannot select a legacy binding engine and malformed scripts expose gaps', () => {
    const {analyzeTemplate} = require('../lib/template');
    const result = analyzeTemplate('<div x-data="{}"></div><script>window.text = `${42}`;</script>', 'a'.repeat(32), 'auto', {});
    assert.deepEqual(result.engines, ['alpine', 'inline-script']);
    assert.equal(result.scripts[0].status, 'instrumented');
    const invalid = analyzeTemplate('<div x-data="{}"></div><script>const = broken;</script>', 'a'.repeat(32), 'auto', {});
    assert.equal(invalid.scripts[0].status, 'unsupported');
    assert.ok(invalid.content.includes('<script>const = broken;</script>'));
    assert.equal(invalid.statements.length, 1);
});


test('Alpine template literals are not classified as jQuery templates in HTML or PHTML', () => {
    const {analyzeTemplate} = require('../lib/template');
    for (const phtml of [false, true]) {
        const source = '<div x-data="{name: 1}"><span x-text="`Count: ${name}`"></span></div>';
        const result = analyzeTemplate(source, 'a'.repeat(32), 'auto', {phtml});
        assert.deepEqual(result.engines, ['alpine']);
        assert.deepEqual(result.statements.map(item => item.syntax), ['alpine:data', 'alpine:text']);
        assert.doesNotMatch(result.content, /\{\{mtc/);
        const mixed = analyzeTemplate(source + '<b>${label}</b>', 'a'.repeat(32), 'auto', {phtml});
        assert.deepEqual(mixed.engines, ['jquery-tmpl']);
        assert.ok(mixed.content.includes('x-text="`Count: ${name}`"'));
    }
});
