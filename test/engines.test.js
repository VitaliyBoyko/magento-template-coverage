'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const _ = require('underscore');
const { analyzeStatements } = require('../lib/statements');
const { createManifest, merge, writeReport } = require('../lib');
const id = 'a'.repeat(32);

function renderUnderscore(source, data) {
    const result = analyzeStatements(source, id), hits = {};
    const compiled = _.template(result.content).source;
    const rendered = vm.runInNewContext(`(${compiled})({data})`, {
        _, data, window: { __mtcTemplateHit(template, statement) {
            assert.equal(template, id); hits[statement] = (hits[statement] || 0) + 1;
        } }
    });
    assert.equal(rendered, _.template(source)({data}), 'Coverage changed the rendered HTML');
    return { ...result, hits, rendered };
}

test('Underscore measures real expression execution across branches, loops, closures and escaped output', () => {
    const source = `<% var calls = 0; function read(x) { calls++; return x; } %>
<% if (data.open) { %><b><%= read(data.name) %></b><% } else { %><i><%- read(data.name) %></i><% } %>
<% data.items.forEach(function(item) { %><span><%= read(item) %></span><% }); %>
<% for (var i=0; i < data.items.length; i++) { if (i === 1) continue; %><em><%= i %></em><% } %>
<% if (false) { %><%= missing.never() %><% } %>
<output><%= calls %></output>`;
    const result = renderUnderscore(source, { open: false, name: '<unsafe>', items: ['one', 'two'] });
    assert.match(result.rendered, /&lt;unsafe&gt;/);
    for (const statement of result.statements) {
        const token = source.split('\n')[statement.start.line - 1].slice(statement.start.column);
        if (token.startsWith('<%= read(data.name)') || token.startsWith('<%= missing')) assert.equal(result.hits[statement.id] || 0, 0);
    }
    assert.ok(Object.values(result.hits).some(count => count > 1));
    assert.ok(result.statements.some(s => s.syntax === 'underscore:escape'));
});

test('Underscore preserves method receivers, single calls, returns, switch cases and unbraced conditions', () => {
    const source = `<% var obj = {value: 3, get: function() { return this.value; }}; var out;
if (data.on) out=obj.get(); else out=0;
switch(out) { case 3: out++; break; default: out--; }
function twice(x) { if (x) return x * 2; return 0; }
%><%= twice(out) %>`;
    assert.equal(renderUnderscore(source, { on: true }).rendered, '8');
    assert.equal(renderUnderscore(source, { on: false }).rendered, '-2');
});

test('template literal expressions keep nested braces, newlines and side effects', () => {
    const source = '<p>${ $.read({key: "value"}) }</p>\n<b>${ $.show ? $.name : "hidden" }</b>';
    const result = analyzeStatements(source, id), hits = [];
    const data = { show: false, name: 'Title', calls: 0, read(value) { this.calls++; return value.key; } };
    const output = vm.runInNewContext('`' + result.content + '`', { $: data, window: { __mtcTemplateHit: (...args) => hits.push(args) } });
    assert.equal(output, '<p>value</p>\n<b>hidden</b>');
    assert.equal(data.calls, 1);
    assert.equal(hits.length, 2);
    assert.deepEqual(result.statements.map(s => s.start.line), [1, 2]);
});

test('jQuery directives retain expressions and only add execution tags at reachable locations', () => {
    const source = '{{if active}}<b>${name}</b>{{else}}<i>{{html raw}}</i>{{/if}}\n{{each(i, item) items}}${item}{{/each}}{{! comment}}';
    const result = analyzeStatements(source, id);
    assert.equal(result.content.replace(/\{\{mtc [\s\S]*?\}\}/g, ''), source);
    assert.deepEqual(result.statements.map(s => s.binding), ['if', 'interpolate', 'else', 'html', 'each', 'interpolate']);
    assert.match(result.content, /\{\{else\}\}\{\{mtc/);
    assert.throws(() => analyzeStatements('{{custom data}}', id, 'jquery-tmpl'), /Unsupported jQuery/);
});

test('all and only .html files are inventoried, engine overrides invalidate identity, and email has no invented lines', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-all-html-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'app/code'), { recursive: true });
    fs.mkdirSync(path.join(root, 'app/design'), { recursive: true });
    const sources = { 'fragment.html': '<p>${name}</p>', 'skip.htm': '<p>Skip</p>', 'skip.phtml': '<?php echo 1; ?>', 'email.html': '<p>{{var customer.name}}</p>', 'plain.html': '<p>Static</p>' };
    for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join(root, 'app/code', name), source);
    const auto = createManifest({ source: root });
    assert.equal(auto.templates.length, 3);
    assert.ok(auto.templates.every(entry => entry.path.endsWith('.html')));
    assert.equal(auto.templates.find(entry => entry.path.endsWith('email.html')).statements.length, 0);
    const custom = createManifest({ source: root, engines: { 'app/code/fragment.html': 'jquery-tmpl' } });
    const entry = manifest => manifest.templates.find(item => item.path.endsWith('fragment.html'));
    assert.notEqual(entry(auto).id, entry(custom).id);
    assert.equal(entry(custom).statements[0].syntax, 'jquery-tmpl:=');
    assert.throws(() => createManifest({ source: root, engines: { 'app/missing': 'html' } }), /matched no/);
    assert.throws(() => createManifest({ source: root, engines: { '../escape': 'html' } }), /Invalid/);
});

test('directory totals sum counters, preserve zero denominators and link through breadcrumbs offline', t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-directory-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const files = { 'app/code/A/web/a.html': '<p text="one"></p>\n<p text="two"></p>', 'app/code/A/web/nested/b.html': '<p text="three"></p>', 'app/design/theme/static.html': '<p>Static</p>' };
    for (const [name, source] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), source); }
    const manifest = createManifest({ source: root }), first = manifest.templates.find(t => t.path.endsWith('/a.html'));
    const report = merge(manifest, [{ schemaVersion: 2, recordId: 'current', ids: [first.id], hits: { [first.id]: { 0: 1 } } }]);
    const output = path.join(root, 'report'); writeReport(report, output);
    const json = JSON.parse(fs.readFileSync(path.join(output, 'coverage-summary.json')));
    const parent = json.directories.find(d => d.path === 'app/code');
    assert.equal(parent.lines.percent, 33.33, 'Directory percentages must not average file percentages');
    assert.equal(json.directories.find(d => d.path === 'app/design').lines.percent, null);
    const source = fs.readFileSync(path.join(output, `files/${first.id}.html`), 'utf8');
    assert.match(source, /aria-label="Breadcrumb"/);
    const pages = ['index.html', 'all.html', ...json.directories.filter(d => d.path).map(d => d.report), ...manifest.templates.map(e => `files/${e.id}.html`)];
    for (const file of pages) {
        const html = fs.readFileSync(path.join(output, file), 'utf8');
        for (const [, link] of html.matchAll(/href="([^"]+)"/g)) {
            if (link.startsWith('#')) continue;
            assert.ok(fs.existsSync(path.resolve(output, path.dirname(file), decodeURIComponent(link))), `${file}: broken link ${link}`);
        }
    }
});


test('bare Knockout declarations, empty Magento shorthand and SVG retain valid source maps', () => {
    const source = '<div data-bind="collapsible, text: title" toggleCollapsible></div><svg><use xlink:href="#icon"></use></svg>';
    const result = analyzeStatements(source, id);
    assert.equal(result.statements.length, 3);
    assert.match(result.content, /collapsible: \/\*mtc_[^*]+\*\/void 0/);
    assert.match(result.content, /toggleCollapsible="\/\*mtc_[^*]+\*\/void 0"/);
});
