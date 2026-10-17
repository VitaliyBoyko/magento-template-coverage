'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createManifest, instrument, merge} = require('../lib');
const {analyzeStatements} = require('../lib/statements');
const {maskPhp} = require('../lib/alpine');
const id = 'a'.repeat(32);

test('PHTML keeps PHP tokens, strict declarations and source line numbers untouched', t => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-phtml-'));
    t.after(() => fs.rmSync(temporary, {recursive:true,force:true}));
    const source = path.join(temporary, 'source');
    fs.mkdirSync(path.join(source, 'app/code'), {recursive:true});
    const content = `<?php declare(strict_types=1);
// Closing delimiters in quoted strings do not end PHP
$value = '?>';
$literal = <<<'END'
<div x-text="fake"></div>
END;
?>
<div x-data="{name: '<?= htmlspecialchars($value) ?>'}">
<input x-model="name">
<span x-text="name"></span>
</div>`;
    fs.writeFileSync(path.join(source, 'app/code/probe.phtml'), content);
    fs.writeFileSync(path.join(source, 'app/code/plain.phtml'), '<?php echo "plain"; ?>');
    const manifest = createManifest({source, roots: ['app/code']});
    assert.equal(manifest.templates.length, 1);
    const entry = manifest.templates[0];
    assert.equal(entry.kind, 'browser-phtml');
    assert.equal(entry.statements.length, 3);
    assert.deepEqual(entry.statements.map(statement => statement.start.line), [8,9,10]);
    const copy = path.join(temporary, 'copy');
    instrument({source, manifest, mappings: {'app/code': copy}});
    const output = fs.readFileSync(path.join(copy, 'probe.phtml'), 'utf8');
    assert.ok(output.startsWith('<?php declare(strict_types=1);'));
    assert.equal(output.split('\n').length, content.split('\n').length);
    const php = source => maskPhp(source).ranges.map(([start,end]) => source.slice(start,end));
    assert.deepEqual(php(output), php(content));
    assert.equal(fs.readFileSync(path.join(source, 'app/code/probe.phtml'), 'utf8'), content);
    assert.equal(merge(manifest, []).statements.covered, 0);
});

test('mixed HTML keeps Knockout bindings and Alpine events in the same statement map', () => {
    const result = analyzeStatements('<span data-bind="text: label"></span><button x-data="{}" @click="clicked = true">Click</button>', id);
    assert.deepEqual(result.statements.map(statement => statement.syntax), ['data-bind', 'alpine:data', 'alpine:on']);
    assert.match(result.content, /\/\*mtc_/);
    assert.match(result.content, /__mtcTemplateHit/);
});

test('dynamic PHP model expressions stay unchanged with an explicit limitation', () => {
    const source = '<input x-model="values[<?= $key ?>]">';
    const result = analyzeStatements(source, id, 'alpine', {phtml:true});
    assert.equal(result.content, source);
    assert.equal(result.statements.length, 0);
    assert.equal(result.unsupported.length, 1);
});


test('standalone Alpine initialization and HTML directives are discovered', () => {
    for (const [attribute, syntax] of [['x-init="initialize()"', 'alpine:init'], ['x-html="content"', 'alpine:html'], ['x-html-safe="content"', 'alpine:html-safe']]) {
        const result = analyzeStatements(`<div ${attribute}></div>`, id);
        assert.equal(result.statements.length, 1);
        assert.equal(result.statements[0].syntax, syntax);
    }
});
