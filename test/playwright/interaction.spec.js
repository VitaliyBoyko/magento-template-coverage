// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: MIT
// License: see LICENSE in the repository root.

'use strict';
const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {createManifest, instrument, merge, readRecords} = require('../../lib');
const {registerTemplateCoverage} = require('../../playwright');

test.beforeAll(async ({browser}) => {
    const name = process.env.MTC_CHROME_EXECUTABLE_PATH ? 'chrome-for-testing' : browser.browserType().name();
    console.log(`Compatibility browser: ${name} ${browser.version()}; Playwright ${require('@playwright/test/package.json').version}`);
    if (process.env.MTC_CHROME_VERSION) expect(browser.version()).toBe(process.env.MTC_CHROME_VERSION);
});

test('instrumentation preserves inert controls and rendered accessible names', async ({context, page}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-interaction-'));
    const source = path.join(root, 'source'), copy = path.join(root, 'copy');
    const html = `<section x-data="{ locked: true, name: '', choice: 'a', checked: false, count: 0 }">
<button id="unlock" @click="locked = false">Unlock</button>
<div :inert="locked">
<input id="name" x-model="name"><output id="echo" x-text="name"></output>
<select id="choice" x-model="choice"><option value="a">A</option><option value="b">B</option></select>
<input id="checked" type="checkbox" x-model="checked">
<button id="apply" aria-labelledby="label" @click="count++">Apply</button>
<span id="label">Apply <details><summary>Options</summary>Unrendered text</details></span>
<output id="count" x-text="count"></output>
<button id="unused" @click="count = 100">Unused</button>
</div></section>`;
    fs.mkdirSync(path.join(source, 'app/code'), {recursive: true});
    fs.writeFileSync(path.join(source, 'app/code/controls.html'), html);
    const manifest = createManifest({source, roots: ['app/code']});
    instrument({source, manifest, mappings: {'app/code': copy}});
    const server = http.createServer((req, res) => {
        if (req.url === '/alpine.js') {
            res.setHeader('Content-Type', 'application/javascript');
            res.end(fs.readFileSync(require.resolve('alpinejs').replace(/module.cjs.js$/, 'cdn.js'))); return;
        }
        if (!['/original', '/instrumented'].includes(req.url)) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', 'text/html');
        const body = req.url === '/original' ? html : fs.readFileSync(path.join(copy, 'controls.html'), 'utf8');
        res.end('<!doctype html><script defer src="/alpine.js"></script>' + body);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const coverage = await registerTemplateCoverage(context, {outputDir: path.join(root, 'hits')});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    try {
        for (const route of ['original', 'instrumented']) {
            await page.goto(`http://127.0.0.1:${server.address().port}/${route}`);
            await expect(page.locator('#count')).toHaveText('0');
            for (const action of [
                () => page.locator('#name').fill('blocked', {timeout: 300}),
                () => page.locator('#choice').selectOption('b', {timeout: 300}),
                () => page.locator('#checked').check({timeout: 300}),
                () => page.locator('#apply').click({timeout: 300})
            ]) await expect(action()).rejects.toThrow(/inert/);
            await expect(page.locator('#name')).toHaveValue('');
            await expect(page.locator('#choice')).toHaveValue('a');
            await expect(page.locator('#checked')).not.toBeChecked();
            await expect(page.locator('#count')).toHaveText('0');
            await page.getByRole('button', {name: 'Unlock', exact: true}).click();
            await page.locator('#name').fill('updated');
            await expect(page.locator('#echo')).toHaveText('updated');
            await page.locator('#choice').selectOption('b');
            await expect(page.locator('#choice')).toHaveValue('b');
            await page.locator('#checked').check();
            await expect(page.locator('#checked')).toBeChecked();
            await page.getByRole('button', {name: 'Apply Options', exact: true}).click();
            await expect(page.locator('#count')).toHaveText('1');
        }
        expect(errors).toEqual([]);
        await coverage.stop();
        const records = readRecords(path.join(root, 'hits'));
        expect(records).toHaveLength(1);
        const entry = manifest.templates[0];
        const click = id => entry.statements.find(statement => statement.binding === '@click' &&
            entry.source.split('\n')[statement.start.line - 1].includes(`id="${id}"`));
        expect(records[0].hits[entry.id][click('apply').id]).toBe(1);
        expect(records[0].hits[entry.id][click('unused').id] || 0).toBe(0);
        expect(merge(manifest, records).templates[0].unsupportedDirectives || []).toEqual([]);
        expect(fs.readFileSync(path.join(source, 'app/code/controls.html'), 'utf8')).toBe(html);
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, {recursive: true, force: true});
    }
});
