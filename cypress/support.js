'use strict';

const { observeTemplates } = require('../lib/browser');
const { observeExecution } = require('../lib/execution');

function registerTemplateCoverage({ outputDir = '.template-coverage' } = {}) {
    let collector;
    let execution;
    let ids = new Set();
    let hits = {};

    function connect(win) {
        collector?.disconnect();
        execution?.disconnect();
        collector = observeTemplates(win, id => ids.add(id));
        execution = observeExecution(win, (id, statement) => {
            const counters = hits[id] ||= {};
            counters[statement] = (counters[statement] || 0) + 1;
        });
    }

    Cypress.on('test:before:run', () => {
        if (collector) collector.disconnect();
        execution?.disconnect();
        collector = undefined;
        ids = new Set();
        hits = {};
    });
    Cypress.on('window:before:load', win => {
        connect(win);
    });
    Cypress.on('window:before:unload', () => {
        if (collector) collector.flush();
    });

    beforeEach(() => {
        // Also supports tests that keep the current page with testIsolation: false.
        cy.window({ log: false }).then(win => {
            if (!collector) connect(win);
        });
    });

    afterEach(function () {
        // Queue this after existing test commands; retain IDs from previous pages.
        cy.then({ log: false }, () => {
            if (collector) collector.flush();
            const recordId = globalThis.crypto.randomUUID?.() ||
                `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
            const record = {
                schemaVersion: 2,
                recordId,
                spec: Cypress.spec.relative,
                test: Cypress.currentTest.titlePath,
                retry: this.currentTest.currentRetry(),
                ids: [...ids].sort(),
                hits
            };
            return cy.writeFile(`${outputDir}/${recordId}.mtc`, JSON.stringify(record), { log: false });
        });
    });
}

module.exports = { registerTemplateCoverage };
