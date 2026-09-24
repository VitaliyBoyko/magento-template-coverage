'use strict';

const { observeTemplates } = require('../lib/browser');

function registerTemplateCoverage({ outputDir = '.template-coverage' } = {}) {
    let collector;
    let ids = new Set();

    Cypress.on('test:before:run', () => {
        if (collector) collector.disconnect();
        collector = undefined;
        ids = new Set();
    });
    Cypress.on('window:before:load', win => {
        if (collector) collector.disconnect();
        collector = observeTemplates(win, id => ids.add(id));
    });
    Cypress.on('window:before:unload', () => {
        if (collector) collector.flush();
    });

    beforeEach(() => {
        // Also supports tests that keep the current page with testIsolation: false.
        cy.window({ log: false }).then(win => {
            if (!collector) collector = observeTemplates(win, id => ids.add(id));
        });
    });

    afterEach(function () {
        // Queue this after existing test commands; retain IDs from previous pages.
        cy.then({ log: false }, () => {
            if (collector) collector.flush();
            const recordId = globalThis.crypto.randomUUID?.() ||
                `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
            const record = {
                schemaVersion: 1,
                recordId,
                spec: Cypress.spec.relative,
                test: Cypress.currentTest.titlePath,
                retry: this.currentTest.currentRetry(),
                ids: [...ids].sort()
            };
            return cy.writeFile(`${outputDir}/${recordId}.mtc`, JSON.stringify(record), { log: false });
        });
    });
}

module.exports = { registerTemplateCoverage };
