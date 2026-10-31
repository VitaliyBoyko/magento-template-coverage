// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: MIT
// License: see LICENSE in the repository root.

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {test: base, expect} = require('@playwright/test');
const {withTemplateCoverage} = require('../../playwright');
const {createManifest, instrument, merge, readRecords, writeReport} = require('../../lib');
const generated = require('../generated-fixture');

const test = withTemplateCoverage(base).extend({
    fixture: [async ({}, use) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-playwright-'));
        const source = path.join(root, 'source');
        const copy = path.join(root, 'copy');
        fs.mkdirSync(path.join(source, 'app/code'), {recursive: true});
        const files = {
            'alpine.html': `<section x-data="{ count: 0, name: 'initial', open: false, items: ['one','two'], choice: 'a' }">
<button id="increment" @click="count++">Increment</button>
<output id="count" x-text="count"></output>
<span id="template-literal" x-text="\`Count: \${count}\`"></span>
<input id="name" x-model="name"><span id="echo" x-text="name"></span>
<template x-if="open"><div id="never" x-text="'not executed'"></div></template>
<template x-for="item in items"><span class="item" x-text="item"></span></template>
<div id="initialized" x-init="let value = 3; $el.dataset.value = value"></div>
<button id="unused-event" @click="count = 100">Unused</button>
<input type="radio" id="radio-a" value="a" x-model="choice"><input type="radio" id="radio-b" value="b" x-model="choice">
<a href="/second.html">Next</a>
</section>`,
            'knockout.html': '<section id="ko"><input id="ko-input" data-bind="textInput: name"><span id="ko-output" data-bind="text: name"></span></section><script>ko.applyBindings({name:ko.observable("original")},document.getElementById("ko"))</script>',
            'scripts.html': `<button id="call" onclick="window.choose(true)">Call</button>
<script>
window.calls = 0;
window.choose = function choose(value) { if(value) { window.calls++; return 'yes'; } return 'no'; };
</script>
<template id="cached"><script>window.inserted = (window.inserted || 0) + 1;</script></template>
<template id="unused-script"><script>window.neverInserted = true;</script></template>`,
            'fragment.html': '<script>window.fromFragment = (window.fromFragment || 0) + 1;</script>',
            'module.html': '<script type="module">window.fromModule = 42;</script>',
            'second.html': '<div id="second">Second document</div>',
            'unused.html': '<div x-data="{}" x-text="\'unused\'"></div>'
        };
        for (const [file, body] of Object.entries(files)) fs.writeFileSync(path.join(source, 'app/code', file), body);
        generated.writeFixtures(path.join(source, 'app/code'));
        const manifest = createManifest({source, roots: ['app/code']});
        instrument({source, manifest, mappings: {'app/code': copy}});
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, 'http://localhost');
            if (url.pathname === '/generated-parent.phtml') {
                res.setHeader('Content-Type', 'text/html');
                res.end(generated.render(copy, url.searchParams.get('mode') || 'child')); return;
            }
            const filename = req.url.slice(1);
            if (filename === 'knockout.js') {
                res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(require.resolve('knockout'))); return;
            }
            if (filename === 'alpine.js') {
                res.setHeader('Content-Type', 'application/javascript');
                res.end(fs.readFileSync(require.resolve('alpinejs').replace(/module.cjs.js$/, 'cdn.js'))); return;
            }
            if (!Object.hasOwn(files, filename)) { res.writeHead(404).end(); return; }
            res.setHeader('Content-Type', 'text/html');
            if (filename === 'fragment.html') { res.end(fs.readFileSync(path.join(copy, filename))); return; }
            res.end('<!doctype html><html><head><script src="/knockout.js"></script><script defer src="/alpine.js"></script></head><body>' + fs.readFileSync(path.join(copy, filename)) + '</body></html>');
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try { await use({root, manifest, url: `http://127.0.0.1:${server.address().port}`}); }
        finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, {recursive: true, force: true}); }
    }, {scope: 'worker'}],
    baseURL: async ({fixture}, use) => use(fixture.url),
    templateCoverageOptions: async ({fixture}, use) => use({outputDir: path.join(fixture.root, 'hits')})
});

test('Alpine executes directives without changing inputs, branches or loops', async ({page}) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/alpine.html');
    await expect(page.locator('#count')).toHaveText('0');
    await page.locator('#increment').click();
    await expect(page.locator('#count')).toHaveText('1');
    await expect(page.locator('#template-literal')).toHaveText('Count: 1');
    await page.locator('#name').fill('updated');
    await expect(page.locator('#echo')).toHaveText('updated');
    await expect(page.locator('.item')).toHaveText(['one', 'two']);
    await expect(page.locator('#initialized')).toHaveAttribute('data-value', '3');
    await expect(page.locator('#never')).toHaveCount(0);
    await expect(page.locator('#radio-a')).toBeChecked();
    await page.locator('#radio-b').check();
    await expect(page.locator('#radio-a')).not.toBeChecked();
    await expect(page.locator('#radio-b')).toBeChecked();
    expect(await page.locator('#radio-a').getAttribute('name')).toBe(await page.locator('#radio-b').getAttribute('name'));
    await page.getByRole('link', {name: 'Next'}).click();
    await expect(page.locator('#second')).toBeVisible();
    expect(errors).toEqual([]);
});

test('new contexts reset hits and collect popups and frames', async ({page, context}) => {
    await page.goto('/second.html');
    const popup = await context.newPage();
    await popup.goto('/alpine.html');
    await expect(popup.locator('#count')).toHaveText('0');
    await popup.close();
    await page.evaluate(() => {const frame = document.createElement('iframe'); frame.src = '/alpine.html'; document.body.appendChild(frame);});
    await expect(page.frameLocator('iframe').locator('#count')).toHaveText('0');
});

test('Playwright also preserves Luma Knockout two-way bindings', async ({page}) => {
    await page.goto('/knockout.html');
    await page.locator('#ko-input').fill('changed');
    await expect(page.locator('#ko-output')).toHaveText('changed');
});

test('writes records when a test assertion fails', async ({page}) => {
    test.fail();
    await page.goto('/alpine.html');
    await page.locator('#increment').click();
    await expect(page.locator('#count')).toHaveText('1');
    await expect(page.locator('#template-literal')).toHaveText('Count: 1');
    expect('intentional failure').toBe('expected assertion');
});

const navigatesDuringSetup = test.extend({_visit: [async ({page}, use) => {
    await page.goto('/alpine.html');
    await expect(page.locator('#count')).toHaveText('0');
    await use();
}, {auto: true}]});
navigatesDuringSetup('collects navigation performed by another automatic fixture', async ({page}) => {
    await expect(page.locator('#echo')).toHaveText('initial');
});

test('collects inline scripts, consumed templates, module scripts and inserted fragments without JS coverage', async ({page}) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/scripts.html');
    expect(await page.evaluate(() => [window.calls, window.inserted, window.neverInserted, window.__coverage__])).toEqual([0, undefined, undefined, undefined]);
    await page.locator('#call').click();
    expect(await page.evaluate(() => window.calls)).toBe(1);
    await page.evaluate(() => {
        document.body.appendChild(document.querySelector('#cached').content.cloneNode(true));
        document.body.appendChild(document.querySelector('#cached').content.cloneNode(true));
    });
    expect(await page.evaluate(() => window.inserted)).toBe(2);
    await page.evaluate(async () => {
        const html = await (await fetch('/fragment.html')).text();
        const container = document.createElement('div'); container.innerHTML = html;
        const script = document.createElement('script'); script.textContent = container.querySelector('script').textContent;
        document.body.append(script);
    });
    expect(await page.evaluate(() => window.fromFragment)).toBe(1);
    expect(await page.evaluate(() => window.__coverage__)).toBeUndefined();
    await page.goto('/module.html');
    await expect.poll(() => page.evaluate(() => window.fromModule)).toBe(42);
    expect(errors).toEqual([]);
});

test('links a PHP-rendered child without counting its uncalled function body', async ({page}) => {
    await page.goto('/generated-parent.phtml');
    await expect(page.locator('#generated-call')).toBeVisible();
    expect(await page.evaluate(() => window.childResult)).toBeUndefined();
});

test('collects child-template execution at the child source location', async ({page}) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/generated-parent.phtml');
    await page.locator('#generated-call').click();
    expect(await page.evaluate(() => window.childResult)).toBe('yes');
    await page.evaluate(() => window.generatedRun(false));
    expect(await page.evaluate(() => [window.childResult, window.childNever, window.__coverage__])).toEqual(['no', undefined, undefined]);
    expect(errors).toEqual([]);
});

test('retains empty and unknown PHP output attribution across navigation', async ({page}) => {
    await page.goto('/generated-parent.phtml?mode=empty');
    await page.locator('#generated-call').click();
    await page.goto('/generated-parent.phtml?mode=unknown');
    await page.locator('#generated-call').click();
    expect(await page.evaluate(() => window.unknownOutput)).toBe(true);
});

test.afterAll(async ({fixture}) => {
    const records = readRecords(path.join(fixture.root, 'hits'));
    assert.equal(records.length, 9);
    const child = fixture.manifest.templates.find(entry => entry.path.endsWith('generated-child.phtml'));
    const idle = records.find(record => record.test.at(-1).startsWith('links a PHP-rendered'));
    assert.equal(idle.hits[child.id], undefined);
    assert.equal(merge(fixture.manifest, [idle]).scripts.references[0].status, 'linked');
    const called = records.find(record => record.test.at(-1).startsWith('collects child-template'));
    const childResult = merge(fixture.manifest, [called]).templates.find(entry => entry.id === child.id);
    assert.equal(childResult.functionSummary.covered, 1);
    assert.equal(childResult.branchSummary.covered, childResult.branchSummary.total);
    const variants = records.find(record => record.test.at(-1).startsWith('retains empty and unknown'));
    assert.equal(variants.references.length, 2);
    assert.equal(merge(fixture.manifest, [variants]).scripts.references[0].status, 'unresolved');
    const entry = fixture.manifest.templates.find(entry => entry.path.endsWith('alpine.html'));
    const line = (text, binding) => entry.statements.find(statement => (!binding || statement.binding === binding) && entry.source.split('\n')[statement.start.line - 1].includes(text));
    const first = records.find(record => record.test.at(-1).startsWith('Alpine executes'));
    const second = records.find(record => record.test.at(-1).startsWith('new contexts'));
    assert.equal(first.hits[entry.id][line('id="increment"').id], 1);
    assert.equal(second.hits[entry.id][line('id="increment"').id] || 0, 0);
    assert.equal(first.hits[entry.id][line('id="never"', 'x-text').id] || 0, 0);
    assert.equal(first.hits[entry.id][line('id="unused-event"').id] || 0, 0);
    assert.ok(second.hits[entry.id][line('<section').id] >= 2, 'Closed page and iframe must both survive collection');
    const knockout = fixture.manifest.templates.find(entry => entry.path.endsWith('knockout.html'));
    assert.equal(knockout.statements.length, 3);
    assert.equal(Object.keys(records.find(record => record.test.at(-1).includes('Luma')).hits[knockout.id]).length, 3);
    const failed = records.find(record => record.test.at(-1).includes('assertion fails'));
    assert.equal(failed.hits[entry.id][line('id="increment"').id], 1);
    const setup = records.find(record => record.test.at(-1).includes('automatic fixture'));
    assert.equal(setup.hits[entry.id][line('<section').id], 1);
    const scriptRecord = records.find(record => record.test.at(-1).startsWith('collects inline scripts'));
    const scripts = fixture.manifest.templates.find(entry => entry.path.endsWith('/scripts.html'));
    assert.equal(scriptRecord.hits[scripts.id]['script:2:s:0'], 2);
    assert.equal(scriptRecord.hits[scripts.id]['script:3:s:0'] || 0, 0);
    assert.equal(scriptRecord.hits[scripts.id]['script:1:f:0'], 1);
    const fragment = fixture.manifest.templates.find(entry => entry.path.endsWith('/fragment.html'));
    assert.equal(scriptRecord.hits[fragment.id]['script:1:s:0'], 1);
    const module = fixture.manifest.templates.find(entry => entry.path.endsWith('/module.html'));
    assert.equal(scriptRecord.hits[module.id]['script:1:s:0'], 1);
    const report = merge(fixture.manifest, records);
    assert.equal(report.templates.find(entry => entry.path.endsWith('unused.html')).status, 'unobserved');
    writeReport(report, path.join(fixture.root, 'report'));
    console.log(`Verified ${records.length} Playwright records and real Alpine execution.`);
});
