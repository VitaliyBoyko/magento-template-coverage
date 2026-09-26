'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManifest, instrument, merge, readRecords, writeReport } = require('../lib');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'magento-template-coverage-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const source = path.join(directory, 'magento');
    const files = {
        'app/code/Application/Blog/view/frontend/web/template/root.html': '<div>Root</div>',
        'app/code/Application/Blog/view/frontend/web/template/unused.html': '<div>Unused</div>',
        'app/code/Application/Blog/view/frontend/email/order.html': '<div>{{var order}}</div>',
        'app/code/Application/Blog/view/frontend/templates/block.phtml': '<div><?= $block->getName() ?></div>',
        'app/design/frontend/example/theme/Application_Blog/web/templates/modal.html': '<div><%= data.title %></div>',
        'app/design/adminhtml/example/theme/Application_Blog/web/template/grid.html': '<div>Admin</div>'
    };
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
        fs.writeFileSync(path.join(source, file), content);
    }
    const mappings = {
        'app/code': path.join(directory, 'copy/code'),
        'app/design': path.join(directory, 'copy/design')
    };
    return { directory, source, files, mappings, manifest: createManifest({ source }) };
}

test('inventory includes untouched templates, distinguishes unsupported files, and is reproducible', t => {
    const { source, manifest } = fixture(t);
    assert.deepEqual(manifest, createManifest({ source }));
    const report = merge(manifest, []);
    assert.deepEqual(report.summary, { eligible: 4, covered: 0, uncovered: 4, unsupported: 2, percent: 0 });
    assert.equal(manifest.templates.filter(entry => entry.area === 'adminhtml').length, 1);
});

test('instrumentation writes only browser HTML in the disposable copy and is repeatable', t => {
    const { source, files, mappings, manifest } = fixture(t);
    assert.equal(instrument({ source, mappings, manifest }), 4);
    assert.equal(instrument({ source, mappings, manifest }), 4);
    for (const [file, original] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(source, file), 'utf8'), original);
    for (const entry of manifest.templates) {
        const root = entry.path.startsWith('app/code/') ? 'app/code' : 'app/design';
        const output = path.join(mappings[root], entry.path.slice(root.length + 1));
        if (entry.instrumented) assert.equal(fs.readFileSync(output, 'utf8'), `<!--mtc:${entry.id}-->\n${files[entry.path]}`);
        else assert.equal(fs.existsSync(output), false);
    }
});

test('original tree, symlinked destinations and stale inputs are rejected before any write', t => {
    const { source, directory, mappings, manifest } = fixture(t);
    assert.throws(() => instrument({ source, manifest, mappings: { ...mappings, 'app/code': path.join(source, 'app/code') } }), /original source/);
    assert.throws(() => instrument({ source, manifest, mappings: { ...mappings, 'app/design': mappings['app/code'] } }), /overlap/);
    fs.mkdirSync(path.join(directory, 'linked-output'));
    fs.symlinkSync(path.join(directory, 'linked-output'), path.join(directory, 'alias'));
    assert.throws(() => instrument({ source, manifest, mappings: { ...mappings, 'app/code': path.join(directory, 'alias') } }), /symlinked destination/);
    const destination = path.join(mappings['app/code'], 'Application');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(path.join(source, 'app/code/Application'), destination);
    assert.throws(() => instrument({ source, manifest, mappings }), /symlinked destination/);
    fs.unlinkSync(destination);
    const changed = manifest.templates.find(entry => entry.instrumented);
    fs.appendFileSync(path.join(source, changed.path), '\nchanged');
    assert.throws(() => instrument({ source, manifest, mappings }), /Source changed/);
    assert.equal(fs.existsSync(path.join(directory, 'copy/design')), false);
});

test('hardlinked copies cannot mutate the original file', t => {
    const { source, files, mappings, manifest } = fixture(t);
    const entry = manifest.templates.find(item => item.instrumented && item.path.startsWith('app/code/'));
    const original = path.join(source, entry.path);
    const destination = path.join(mappings['app/code'], entry.path.slice('app/code/'.length));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.linkSync(original, destination);
    instrument({ source, manifest, mappings });
    assert.equal(fs.readFileSync(original, 'utf8'), files[entry.path]);
    assert.match(fs.readFileSync(destination, 'utf8'), /<!--mtc:/);
});

test('path traversal in a supplied manifest cannot escape the source or output', t => {
    const { source, mappings, manifest } = fixture(t);
    manifest.templates[0].path = 'app/code/../../../../escape.html';
    assert.throws(() => instrument({ source, manifest, mappings }), /Invalid/);
});

test('source identity separates theme overrides and invalidates changed templates', t => {
    const { source, manifest } = fixture(t);
    const file = manifest.templates.find(entry => entry.instrumented);
    fs.appendFileSync(path.join(source, file.path), '\nchanged');
    const updated = createManifest({ source });
    assert.notEqual(updated.templates.find(entry => entry.path === file.path).id, file.id);
    assert.equal(new Set(manifest.templates.map(entry => entry.id)).size, manifest.templates.length);
});

test('merging retains zeros, deduplicates copied records and rejects stale hits', t => {
    const { manifest } = fixture(t);
    const supported = manifest.templates.filter(entry => entry.instrumented);
    const first = { schemaVersion: 2, recordId: 'shard-1', ids: [supported[0].id, supported[0].id], hits: {} };
    const second = { schemaVersion: 2, recordId: 'shard-2', ids: [supported[1].id, supported[0].id], hits: {} };
    const report = merge(manifest, [first, first, second]);
    assert.deepEqual(report.summary, { eligible: 4, covered: 2, uncovered: 2, unsupported: 2, percent: 50 });
    assert.equal(report.records, 2);
    assert.equal(report.templates.find(entry => entry.id === supported[0].id).observations, 2);
    assert.throws(() => merge(manifest, [{ ...first, ids: ['a'.repeat(32)] }]), /stale manifest/);
    assert.throws(() => merge(manifest, [first, { ...first, ids: [] }]), /Conflicting/);
});

test('report escapes source names and only reads .mtc records alongside Istanbul JSON', t => {
    const { directory, manifest } = fixture(t);
    manifest.templates[0].path = 'app/code/<script>alert(1)</script>.html';
    const hits = path.join(directory, 'hits');
    fs.mkdirSync(hits);
    const record = { schemaVersion: 2, recordId: 'empty-test', ids: [], hits: {} };
    fs.writeFileSync(path.join(hits, 'one.mtc'), JSON.stringify(record));
    fs.writeFileSync(path.join(hits, 'istanbul.json'), '{}');
    assert.deepEqual(readRecords(hits), [record]);
    const output = path.join(directory, 'report');
    writeReport(merge(manifest, []), output);
    const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /No browser observations collected/);
    assert.match(html, /&lt;script&gt;alert/);
    assert.doesNotMatch(html, /<script>alert/);
});
