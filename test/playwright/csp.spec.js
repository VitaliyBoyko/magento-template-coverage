'use strict';
const {test, expect} = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {createManifest, instrument, readRecords} = require('../../lib');
const {installTemplateRuntime, registerTemplateCoverage} = require('../../playwright');
const fixture = require('../csp-fixture');

test('strict CSP preserves Alpine behavior, scopes and execution coverage', async ({context, page}) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mtc-csp-'));
    const source = path.join(root, 'source'), copy = path.join(root, 'copy');
    fixture.write(path.join(source, 'app/code'));
    const manifest = createManifest({source, roots: ['app/code']});
    instrument({source, manifest, mappings: {'app/code': copy}});
    const server = http.createServer((req, res) => {if (!fixture.serve(req, res, copy)) res.writeHead(404).end();});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const coverage = await registerTemplateCoverage(context, {outputDir: path.join(root, 'hits')});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(() => {
        window.cspViolations = [];
        document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
    });
    try {
        for (const file of ['csp-baseline.html', 'csp.html']) {
            const response = await page.goto(`http://127.0.0.1:${server.address().port}/${file}`);
            expect(response.headers()['content-security-policy']).toBe(fixture.policy);
            await expect(page.locator('#initialized')).toHaveText('ready');
            await expect(page.locator('#echo')).toHaveText('initial');
            await page.locator('#name').fill('updated');
            await expect(page.locator('#echo')).toHaveText('updated');
            await page.locator('#increment').click();
            await page.locator('#async').click();
            await expect(page.locator('#count')).toHaveText('2');
            await expect(page.locator('.item')).toHaveText(['one', 'two']);
            await expect(page.locator('#never')).toHaveCount(0);
            await page.locator('#insert').click();
            await expect(page.locator('#inserted')).toHaveText('updated');
            expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
        }
        expect(errors).toEqual([]);
        await coverage.stop();
        fixture.verify(manifest, readRecords(path.join(root, 'hits')));
        const warmupContext = await context.browser().newContext();
        try {
            await installTemplateRuntime(warmupContext);
            const warmup = await warmupContext.newPage();
            await warmup.goto(`http://127.0.0.1:${server.address().port}/csp.html`);
            await warmup.locator('#increment').click();
            await expect(warmup.locator('#count')).toHaveText('1');
        } finally { await warmupContext.close(); }
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(root, {recursive: true, force: true});
    }
});
