'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { analyzeStatements } = require('../lib/statements');
const { installKnockout, observeExecution } = require('../lib/execution');
const { createManifest, merge, writeReport } = require('../lib');
const id = 'a'.repeat(32);

test('source maps cover individual bindings, entities, multiline attributes and virtual comments', () => {
    const source = `<div data-bind="text: 'a,b &amp; c',
        attr: {title: /a,b/.test('a,b') ? '&quot;yes&quot;' : 'no'}"></div>
<!-- ko if: enabled -->
<span text="message"></span>
<!-- /ko -->`;
    const result = analyzeStatements(source, id);
    assert.deepEqual(result.statements.map(s => [s.binding, s.start.line, s.syntax]), [
        ['text', 1, 'data-bind'], ['attr', 2, 'data-bind'], ['if', 3, 'ko-comment'], ['text', 4, 'magento-attribute:text']
    ]);
    assert.equal(result.content.replace(/\/\*mtc_[^*]+\*\//g, ''), source);
    assert.equal(analyzeStatements('<span\r\n text="\r\n\'x&#10;y\'"></span>', id).statements[0].start.line, 2);
});

test('Magento aliases, custom nodes and render defaults get the correct binding identities', () => {
    const source = `<if args="open"><each args="items"><span ko-value="name" innerif="show"></span></each></if>
<render></render><div render></div><render args=""></render>
<translate args="'Hello'"></translate><div outerfasteach="items" ko-scope="scope"></div>`;
    const result = analyzeStatements(source, id);
    assert.deepEqual(result.statements.map(s => s.binding), ['if', 'foreach', 'value', 'if', 'template', 'template', 'template', 'i18n', 'fastForEach', 'scope']);
    assert.equal((result.content.match(/getTemplate\(\)/g) || []).length, 3);
    assert.ok(result.statements.every(s => s.start.line > 0));
});

test('static markup and inert bodies are not executable lines; dynamic Underscore is explicit', () => {
    const source = `<script type="text/html"><p data-bind="text: hidden"></p></script>
<template><p data-bind="text: hidden"></p></template><p>Static</p>`;
    assert.equal(analyzeStatements(source, id).statements.length, 0);
    const underscore = analyzeStatements('<p data-bind="text: <%= expression %>"></p>', id);
    assert.equal(underscore.statements.length, 0);
    assert.match(underscore.executionUnsupported, /Underscore/);
    assert.throws(() => analyzeStatements('<p data-bind="text: x, text: y"></p>', id), /duplicate/);
});

test('real Knockout accessors execute once and preserve observable identity and plain-property writers', () => {
    const ko = require('knockout');
    const original = ko.bindingProvider.instance.parseBindingsString;
    const hits = [];
    try {
        assert.equal(installKnockout(ko, (template, statement) => hits.push([template, statement])), true);
        const model = { plain: 'before', observable: ko.observable('first'), calls: 0,
            read() { this.calls++; return 'read'; } };
        const source = 'value: /*mtc_' + id + '_0_76616c7565*/plain, text: /*mtc_' + id + '_1_74657874*/read(), checked: /*mtc_' + id + '_2_636865636b6564*/observable';
        const accessors = ko.bindingProvider.instance.parseBindingsString(source, { $data: model }, {}, { valueAccessors: true });
        assert.equal(hits.length, 0, 'parsing alone never records execution');
        assert.equal(accessors.value(), 'before');
        accessors._ko_property_writers().value('after');
        assert.equal(model.plain, 'after');
        assert.equal(accessors.checked(), model.observable);
        assert.equal(accessors.text(), 'read');
        assert.equal(model.calls, 1, 'coverage must not evaluate an expression twice');
        assert.deepEqual(hits.map(hit => hit[1]), ['0', '2', '1']);
        assert.ok(hits.every(hit => hit[0] === id));
    } finally { ko.bindingProvider.instance.parseBindingsString = original; }
});

test('RequireJS attachment retains existing hooks and resets callbacks on retained pages', () => {
    const ko = require('knockout');
    const original = ko.bindingProvider.instance.parseBindingsString;
    const win = {};
    const first = [];
    const second = [];
    try {
        const stop = observeExecution(win, (...hit) => first.push(hit));
        win.requirejs = function () {};
        let chained = 0;
        const previous = win.requirejs.onResourceLoad;
        win.requirejs.onResourceLoad = function () { chained++; previous.apply(this, arguments); };
        win.requirejs.onResourceLoad({ defined: { ko } }, { id: 'ko' });
        const accessor = ko.bindingProvider.instance.parseBindingsString(`text: /*mtc_${id}_0_74657874*/'value'`, { $data: {} }, {}, { valueAccessors: true }).text;
        accessor();
        stop.disconnect();
        accessor();
        observeExecution(win, (...hit) => second.push(hit));
        accessor();
        assert.equal(chained, 1);
        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
    } finally { ko.bindingProvider.instance.parseBindingsString = original; }
});

test('navigation reattaches to a new document behind the same WindowProxy', () => {
    const ko = require('knockout');
    const original = ko.bindingProvider.instance.parseBindingsString;
    const win = { document: {} };
    const first = [];
    const second = [];
    const evaluate = () => ko.bindingProvider.instance.parseBindingsString(
        `text: /*mtc_${id}_0_74657874*/'value'`, { $data: {} }, {}, { valueAccessors: true }).text();
    try {
        const observer = observeExecution(win, (...hit) => first.push(hit));
        win.requirejs = function () {};
        win.requirejs.onResourceLoad({ defined: { ko } }, { id: 'ko' });
        evaluate();
        observer.disconnect();
        ko.bindingProvider.instance.parseBindingsString = original;
        delete win.requirejs;
        win.document = {};
        observeExecution(win, (...hit) => second.push(hit));
        win.requirejs = function () {};
        win.requirejs.onResourceLoad({ defined: { ko } }, { id: 'ko' });
        evaluate();
        assert.equal(first.length, 1);
        assert.equal(second.length, 1);
    } finally { ko.bindingProvider.instance.parseBindingsString = original; }
});

test('UTF-8 custom binding names retain their accessor identity', () => {
    const ko = require('knockout');
    const original = ko.bindingProvider.instance.parseBindingsString;
    const hits = [];
    try {
        installKnockout(ko, (...hit) => hits.push(hit));
        const encoded = Buffer.from('назва').toString('hex');
        const accessors = ko.bindingProvider.instance.parseBindingsString(
            `'назва': /*mtc_${id}_0_${encoded}*/'value'`, { $data: {} }, {}, { valueAccessors: true });
        assert.equal(accessors['назва'](), 'value');
        assert.equal(hits.length, 1);
    } finally { ko.bindingProvider.instance.parseBindingsString = original; }
});

test('merge keeps uncovered statements, distinct line metrics and source details; rejects stale or invalid counts', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-execution-'));
    t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
    const root = path.join(temporary, 'app/code/Application/Blog/view/frontend/web/template');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(temporary, 'app/design'), { recursive: true });
    fs.writeFileSync(path.join(root, 'test.html'), '<p data-bind="text: one, visible: two"></p>\n<span text="three"></span>\n<!-- <script> -->');
    const manifest = createManifest({ source: temporary });
    const entry = manifest.templates[0];
    const record = { schemaVersion: 2, recordId: 'one', ids: [entry.id], hits: { [entry.id]: { 0: 3 } } };
    const report = merge(manifest, [record, record]);
    assert.deepEqual(report.statements, { total: 3, covered: 1, uncovered: 2, percent: 33.33 });
    assert.deepEqual(report.lines, { total: 2, covered: 1, uncovered: 1, percent: 50 });
    assert.equal(report.templates[0].lineHits[1].hits, 3);
    assert.equal(report.templates[0].lineHits[1].covered, 1);
    const output = path.join(temporary, 'report');
    writeReport(report, output);
    const html = fs.readFileSync(path.join(output, `files/${entry.id}.html`), 'utf8');
    assert.match(html, /id="L1" class="partial"/);
    assert.match(html, /id="L2" class="uncovered"/);
    assert.match(html, /&lt;script&gt;/);
    for (const count of [0, -1, 1.5, Infinity, '2']) {
        assert.throws(() => merge(manifest, [{ ...record, hits: { [entry.id]: { 0: count } } }]), /Invalid statement/);
    }
    assert.throws(() => merge(manifest, [{ ...record, schemaVersion: 1 }]), /Invalid template hit/);
    assert.throws(() => merge(manifest, [{ ...record, hits: { [entry.id]: { 99: 1 } } }]), /Invalid statement/);
    assert.throws(() => merge(manifest, [{ ...record, hits: { ['b'.repeat(32)]: { 0: 1 } } }]), /stale manifest/);
    assert.equal(merge(manifest, []).statements.covered, 0, 'new runs never inherit prior counters');
});
