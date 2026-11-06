// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: MIT
// License: see LICENSE in the repository root.

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
        const server = http.createServer((req, res) => {
            if (req.url === '/login' && req.method === 'POST') {
                res.setHeader('Set-Cookie', 'session=authenticated; Path=/admin; HttpOnly; SameSite=Lax');
                res.writeHead(204).end(); return;
            }
            if (req.url === '/administrator') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({cookie: req.headers.cookie || ''})); return;
            }
            if (req.url === '/admin/csp.html') {
                if (req.headers.cookie !== 'session=authenticated') { res.writeHead(401).end(); return; }
                fixture.serve({url: '/csp.html'}, res, copy); return;
            }
            if (!fixture.serve(req, res, copy)) res.writeHead(404).end();
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        try { await use({root, manifest, url: `http://127.0.0.1:${server.address().port}/admin/csp.html`}); }
        finally { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, {recursive: true, force: true}); }
    }, {scope: 'worker'}],
    login: [async ({browser, site}, use) => {
        const context = await browser.newContext();
        let state;
        try {
            expect((await context.request.post(new URL('/login', site.url).href)).status()).toBe(204);
            const page = await context.newPage();
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            await page.goto(site.url);
            for (let i = 0; i < 7; i++) await page.locator('#increment').click();
            await expect(page.locator('#count')).toHaveText('7');
            expect(errors).toEqual([]);
            expect(fs.existsSync(path.join(site.root, 'hits'))).toBe(false);
            state = await context.storageState();
        } finally { await context.close(); }
        await use(state);
    }, {scope: 'worker'}],
    storageState: async ({login}, use) => use(login)
});
const test = withTemplateCoverage(authenticated).extend({
    templateCoverageOptions: async ({site}, use) => use({outputDir: path.join(site.root, 'hits')})
});

test('worker login contexts run CSP bindings without adding coverage records', async ({page, context, site}) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    expect((await context.cookies(site.url)).map(cookie => cookie.name)).toEqual(['session']);
    const outside = new URL('/administrator', site.url).href;
    expect(await context.cookies(outside)).toEqual([]);
    expect(await (await context.request.get(outside)).json()).toEqual({cookie: ''});
    expect((await page.goto(site.url)).status()).toBe(200);
    await expect(page.locator('#count')).toHaveText('0');
    await page.locator('#increment').click();
    await expect(page.locator('#count')).toHaveText('1');
    expect(errors).toEqual([]);
});

test.afterAll(async ({site}) => {
    const records = readRecords(path.join(site.root, 'hits'));
    expect(records).toHaveLength(1);
    const template = site.manifest.templates.find(entry => entry.path.endsWith('/csp.phtml'));
    const click = template.statements.find(statement => statement.binding === '@click' && template.source.split('\n')[statement.start.line - 1].includes('id="increment"'));
    expect(click).toBeDefined();
    // Alpine CSP 3.14 reads the method path for its type check and invocation.
    expect(records[0].hits[template.id][click.id]).toBe(2);
});
