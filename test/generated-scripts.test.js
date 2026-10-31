// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: MIT
// License: see LICENSE in the repository root.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createManifest, instrument, merge, writeReport} = require('../lib');
const {writeFixtures, render, parseReferences} = require('./generated-fixture');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-generated-'));
    t.after(() => fs.rmSync(root, {recursive: true, force: true}));
    const source = path.join(root, 'source'), copy = path.join(root, 'copy');
    writeFixtures(path.join(source, 'app/code'));
    const manifest = createManifest({source, roots: ['app/code']});
    instrument({source, manifest, mappings: {'app/code': copy}});
    for (const entry of manifest.templates) assert.equal(fs.readFileSync(path.join(copy, path.basename(entry.path)), 'utf8').replace(/[^\r\n]/g, ''), entry.source.replace(/[^\r\n]/g, ''));
    return {root, source, copy, manifest, child: manifest.templates.find(t => t.path.endsWith('child.phtml')), parent: manifest.templates.find(t => t.path.endsWith('parent.phtml'))};
}

test('PHP child output links to its original source without recording render-only execution', t => {
    const {root, source, copy, manifest, child, parent} = fixture(t);
    const html = render(copy), references = parseReferences(html), hits = {};
    assert.deepEqual(references, [{template: parent.id, fragment: 'script:1:g:0', targets: [child.id], empty: false}]);
    const window = {__mtcTemplateHit(id, key) {const counts = hits[id] ||= {}; counts[key] = (counts[key] || 0) + 1;}};
    vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {window});
    const record = {schemaVersion: 2, recordId: 'one', ids: [parent.id], hits, references};
    const before = merge(manifest, [record]);
    assert.equal(before.templates.find(t => t.id === child.id).statementSummary.covered, 0);
    assert.equal(before.scripts.generated.length, 0);
    assert.equal(before.scripts.references[0].status, 'linked');
    assert.equal(before.templates.find(t => t.id === child.id).status, 'unobserved');
    const baseline = {};
    vm.runInNewContext(render(path.join(source, 'app/code')).match(/<script>([\s\S]*?)<\/script>/)[1], {window: baseline});
    for (const enabled of [true, false]) {
        window.generatedRun(enabled); baseline.generatedRun(enabled);
        assert.equal(window.childResult, baseline.childResult);
    }
    const after = merge(manifest, [record, record]);
    const result = after.templates.find(t => t.id === child.id);
    assert.ok(result.statementSummary.covered > 0);
    assert.equal(result.functionSummary.covered, 1);
    assert.equal(result.functionSummary.total, 2);
    assert.equal(result.branchSummary.covered, result.branchSummary.total);
    assert.equal(window.__coverage__, undefined);
    writeReport(after, path.join(root, 'report'));
    const report = fs.readFileSync(path.join(root, 'report/files', parent.id + '.html'), 'utf8');
    assert.match(report, new RegExp(`href="${child.id}\\.html"`));
});

test('empty, unobserved and unknown PHP output remain distinct across rendered variants', t => {
    const {copy, manifest, child} = fixture(t);
    const record = (mode, index = 0) => ({schemaVersion: 2, recordId: mode + index, ids: [], hits: {}, references: parseReferences(render(copy, mode))});
    const status = records => merge(manifest, records).scripts.references[0].status;
    assert.equal(status([]), 'unobserved');
    assert.equal(status([record('empty')]), 'empty');
    assert.equal(status([record('unknown')]), 'unresolved');
    assert.equal(status([record('child'), record('empty')]), 'linked');
    const mixed = merge(manifest, [record('child'), record('unknown')]);
    assert.equal(mixed.scripts.generated.length, 1);
    assert.equal(mixed.scripts.references[0].status, 'unresolved');
    assert.deepEqual(mixed.scripts.references[0].targets, [{id: child.id, path: child.path}]);
    const stale = record('child'); stale.references[0].targets = ['f'.repeat(32)];
    assert.throws(() => merge(manifest, [stale]), /Invalid template reference/);
    const invalid = record('child'); invalid.references[0].empty = true;
    assert.throws(() => merge(manifest, [invalid]), /Invalid template reference/);
});
