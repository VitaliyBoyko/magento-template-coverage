'use strict';
const {test: base, expect} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {createManifest, instrument, readRecords} = require('../../lib');
const {withTemplateCoverage} = require('../../playwright');
const fixture = require('../csp-fixture');

const authenticated = base.extend({
    site: [async ({}, use) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-csp-worker-'));
        const source = path.join(root, 'source'), copy = path.join(root, 'copy');
        fixture.write(path.join(source, 'app/code'));
        const manifest = createManifest({source, roots: ['app/code']});
        instrument({source, manifest, mappings: {'app/code': copy}});
        const server = http.createServer((req, res) => {if (!fixture.serve(req, res, copy)) res.writeHead(404).end();});
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try { await use({root, manifest, url: `http://127.0.0.1:${server.address().port}/csp.html`}); }
        finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, {recursive: true, force: true}); }
    }, {scope: 'worker'}],
    login: [async ({browser, site}, use) => {
        const context = await browser.newContext();
        try {
            const page = await context.newPage();
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.goto(site.url);
            for (let i = 0; i < 7; i++) await page.locator('#increment').click();
            await expect(page.locator('#count')).toHaveText('7');
            expect(errors).toEqual([]);
            expect(fs.existsSync(path.join(site.root, 'hits'))).toBe(false);
        } finally { await context.close(); }
        await use(true);
    }, {scope: 'worker'}],
    storageState: async ({login}, use) => { expect(login).toBe(true); await use({cookies: [], origins: []}); }
});
const test = withTemplateCoverage(authenticated).extend({
    templateCoverageOptions: async ({site}, use) => use({outputDir: path.join(site.root, 'hits')})
});

test('worker login contexts run CSP bindings without adding coverage records', async ({page, site}) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(site.url);
    await expect(page.locator('#count')).toHaveText('0');
    await page.locator('#increment').click();
    await expect(page.locator('#count')).toHaveText('1');
    expect(errors).toEqual([]);
});

test.afterAll(async ({site}) => {
    const records = readRecords(path.join(site.root, 'hits'));
    expect(records).toHaveLength(1);
    const template = site.manifest.templates.find(entry => entry.path.endsWith('/csp.html'));
    const click = template.statements.find(statement => statement.binding === '@click' && template.source.split('\n')[statement.start.line - 1].includes('id="increment"'));
    expect(click).toBeDefined();
    // Alpine CSP 3.14 reads the method path for its type check and invocation.
    expect(records[0].hits[template.id][click.id]).toBe(2);
});
