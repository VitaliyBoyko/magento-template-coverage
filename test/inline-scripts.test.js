const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const {instrumentInline, phpIslands} = require('../lib/inline-scripts');

function execute(source) {
    const result = instrumentInline(source, 'a'.repeat(32), {phtml: true});
    assert.deepEqual(result.scripts.filter(script => script.status !== 'instrumented'), []);
    assert.equal(result.code.replace(/[^\r\n]/g, ''), source.replace(/[^\r\n]/g, ''));
    if (!result.scripts.some(script => script.generated.length)) assert.deepEqual(phpIslands(result.code).map(p => p.text), phpIslands(source).map(p => p.text));
    const render = input => execFileSync('php', ['-n'], {input, encoding: 'utf8', timeout: 10000});
    const run = html => {
        const counters = {};
        const context = {window: {__mtcTemplateHit(id, key) {counters[key] = (counters[key] || 0) + 1;}}};
        for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) vm.runInNewContext(match[1], context, {timeout: 1000});
        delete context.window.__mtcTemplateHit;
        assert.equal(context.window.__coverage__, undefined);
        return {value: context.window, counters};
    };
    const expected = run(render(source));
    const actual = run(render(result.code));
    assert.deepEqual(JSON.parse(JSON.stringify(actual.value)), JSON.parse(JSON.stringify(expected.value)));
    const coverage = structuredClone(result.baseline);
    for (const [key, entry] of Object.entries(coverage)) {
        for (const metric of ['s', 'f']) for (const id of Object.keys(entry[metric])) entry[metric][id] = actual.counters[`${key}:${metric}:${id}`] || 0;
        for (const [id, branches] of Object.entries(entry.b)) branches.forEach((_, i) => branches[i] = actual.counters[`${key}:b:${id}:${i}`] || 0);
    }
    return {...result, coverage};
}

test('PHP values, identifier suffixes, strict mode and multiple script blocks preserve behavior and source lines', () => {
    const result = execute(`<?php $id = 'xyz'; $value = 4; ?>
<script>"use strict";
function compute<?= $id ?> (value = <?= $value ?>) {
    const object = {value};
    const double = item => ({value: item * 2});
    if (value > 2) return double(object.value).value;
    else return 0;
}
window.first = computexyz();
window.text = '<?= "quoted ?> text" ?>';
</script>
<?php echo '<div>not JS</div>'; ?>
<script>
window.second = computexyz(1);
window.callback = [1, 2].map(n => n + 1);
</script>`);
    assert.equal(Object.keys(result.coverage).length, 2);
    assert.equal(Object.keys(result.baseline).length, 2);
    assert.ok(Object.values(result.coverage).every(entry => Object.values(entry.s).some(count => count > 0)));
    assert.ok(Object.values(result.baseline).every(entry => Object.values(entry.s).every(count => count === 0)));
    const first = Object.values(result.baseline)[0];
    assert.equal(Object.values(first.fnMap)[0].decl.start.line, 3);
});

test('loops, labels, switch, empty branches, ternaries, logical expressions and ASI retain semantics', () => {
    execute(`<script>
let total = 0
for (let i = 0; i < 4; i++) { if(i === 2) continue; total += i }
let n = 0; while(n < 2) n++;
do n--; while(n > 0);
outer: for (const value of [2, 3]) { if (value === 3) break outer; total += value; }
switch(total) { case 6: total++; break; default: }
const f = (value = 3) => value ? (value && total) : 0;
try { window.answer = f(); } catch(e) { throw e; } finally { window.done = true; }
function empty() { "use strict"; }
empty();
</script>`);
});

test('PHP branches and generated statements remain intact without pretending to measure generated JavaScript', () => {
    const result = execute(`<?php $enabled = false; ?>
<script>
function example() {
<?php if ($enabled): ?>window.disabled = true;<?php endif; ?>
<?= 'window.generated = 42;' ?>
window.visible = true;
}
example();
</script>`);
    assert.equal(result.scripts[0].generated.length, 1);
    assert.ok(Object.values(result.coverage)[0].f[0] > 0);
});

test('external and data scripts stay unchanged while inert scripts receive zero-hit template maps', () => {
    const source = '<script src="external.js">fallback()</script><script type="application/json">{"a":1}</script><script type="text/x-magento-init">{}</script><template><script>never()</script></template>';
    const result = instrumentInline(source, 'a'.repeat(32), {phtml: true});
    assert.equal(result.code.split('<template>')[0], source.split('<template>')[0]);
    assert.equal(result.scripts.length, 1);
    assert.equal(result.statements.length, 1);
    assert.equal(Object.values(result.baseline)[0].s[0], 0);
});

test('module scripts are supported and unsupported PHP syntax stays untouched with a diagnostic', () => {
    const module = instrumentInline('<script type="module">export const answer = 42;</script>', 'src/module.phtml');
    assert.equal(module.scripts[0].status, 'instrumented');
    const source = '<script>function <?php if ($x): ?>one<?php else: ?>two<?php endif; ?>() {return 1;}</script>';
    const result = instrumentInline(source, 'src/dynamic.phtml');
    assert.equal(result.code, source);
    assert.equal(result.scripts[0].status, 'unsupported');
    assert.ok(result.scripts[0].reason);
    assert.deepEqual(result.baseline, {});
});

test('PHP-selected JavaScript initializers cover both rendered values without fabricating JavaScript branches', () => {
    for (const enabled of ['true', 'false']) for (const terminator of ['', ';']) {
        const result = execute(`<?php $enabled = ${enabled}; $value = ['answer' => 40]; ?>
<script>
const selected = <?php if ($enabled): ?>
    <?= json_encode($value) ?>${terminator}
<?php else: ?>
    {answer: 42}${terminator}
<?php endif; ?>;
window.answer = selected.answer;
const chosen = <?php if ($enabled): ?>function () { return 1; }<?php else: ?>() => 2<?php endif; ?>;
window.functionName = chosen.name;
window.functionValue = chosen();
</script>`);
        assert.deepEqual(Object.values(result.baseline)[0].branchMap, {});
        assert.equal(Object.values(result.coverage)[0].s[0], 1);
        assert.equal(result.scripts[0].generated.length, 0);
    }
});

test('inline templates use only template counters and still work without an active collector', () => {
    const source = '<script>"use strict"; window.answer = 42; function unused(){return 0}</script>';
    const result = instrumentInline(source, 'a'.repeat(32));
    const window = {};
    vm.runInNewContext(result.code.match(/<script>([\s\S]*)<\/script>/)[1], {window});
    assert.equal(window.answer, 42);
    assert.equal(window.__coverage__, undefined);
    assert.doesNotMatch(result.code, /cov_[a-z0-9]+|__coverage__/);
    assert.equal(result.functions.length, 1);
});


test('standalone CR and CRLF lines retain original script locations', () => {
    for (const newline of ['\r', '\r\n']) {
        const source = ['<script>', 'window.first = 1;', 'window.second = 2;', '</script>'].join(newline);
        const result = instrumentInline(source, 'a'.repeat(32));
        assert.deepEqual(result.statements.map(statement => statement.start.line), [2, 3]);
        assert.equal(result.code.replace(/[^\r\n]/g, ''), source.replace(/[^\r\n]/g, ''));
    }
});
