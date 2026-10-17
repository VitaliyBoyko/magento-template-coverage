'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { browserSource } = require('../lib/browser-source');
const registeredContexts = new WeakSet();

/** Register before creating/navigating pages. Works with any Playwright browser. */
async function registerTemplateCoverage(context, { outputDir = '.template-coverage', metadata = {} } = {}) {
    if (registeredContexts.has(context)) throw new Error('Register template coverage once per context, before creating pages.');
    registeredContexts.add(context);
    const recordId = randomUUID();
    const binding = `__mtc_${recordId.replaceAll('-', '')}`;
    const documents = new Map();
    let stopped = false;
    await context.exposeBinding(binding, (_source, snapshot) => {
        if (stopped) return;
        const previous = documents.get(snapshot.document);
        if (!previous || snapshot.sequence > previous.sequence) documents.set(snapshot.document, snapshot);
    });
    const script = `(() => {
        const runtime = ${browserSource()};
        const documentId = crypto.randomUUID?.() || Date.now() + '-' + Math.random().toString(36).slice(2);
        const ids = new Set(); const hits = {}; let sequence = 0; let queued = false;
        const pending = new Set();
        const send = () => {
            queued = false;
            const promise = window[${JSON.stringify(binding)}]({document:documentId, sequence:++sequence, ids:[...ids], hits});
            pending.add(promise); promise.catch(() => {}).finally(() => pending.delete(promise));
        };
        const changed = () => { if (!queued) { queued = true; queueMicrotask(send); } };
        const dom = runtime.observeTemplates(window, id => {ids.add(id); changed();});
        const execution = runtime.observeExecution(window, (id, statement) => {
            const counters = hits[id] ||= {}; counters[statement] = (counters[statement] || 0) + 1; changed();
        });
        window.addEventListener('pagehide', () => {dom.flush(); send();});
        Object.defineProperty(window, ${JSON.stringify(binding + '_flush')}, {value: async () => {
            dom.flush(); send(); await Promise.all([...pending]);
        }});
    })();`;
    await context.addInitScript({ content: script });

    async function flush(pages = context.pages()) {
        for (const page of pages) {
            for (const frame of page.frames()) {
                try {
                    await frame.evaluate(key => window[key]?.(), binding + '_flush');
                } catch (error) {
                    // A navigation/closed frame has already streamed its own records.
                    if (!/closed|detached|destroyed|navigation/i.test(error.message)) throw error;
                }
            }
        }
    }
    const closeMethods = new Map();
    const trackPage = page => {
        const close = page.close;
        const wrapped = async function (...args) {
            await flush([page]);
            return close.apply(this, args);
        };
        closeMethods.set(page, {close, wrapped});
        page.close = wrapped;
    };
    context.on('page', trackPage);
    for (const page of context.pages()) trackPage(page);

    async function stop() {
        if (stopped) return;
        await flush();
        stopped = true;
        context.off('page', trackPage);
        for (const [page, {close, wrapped}] of closeMethods) if (page.close === wrapped) page.close = close;
        const ids = new Set(), hits = {};
        for (const snapshot of documents.values()) {
            for (const id of snapshot.ids) ids.add(id);
            for (const [id, statements] of Object.entries(snapshot.hits)) {
                const counters = hits[id] ||= {};
                for (const [statement, count] of Object.entries(statements)) counters[statement] = (counters[statement] || 0) + count;
            }
        }
        const record = { ...metadata, schemaVersion: 2, recordId, ids: [...ids].sort(), hits };
        fs.mkdirSync(outputDir, {recursive: true});
        const file = path.join(outputDir, `${recordId}.mtc`);
        fs.writeFileSync(file, JSON.stringify(record), {flag: 'wx'});
        return file;
    }
    return { flush, stop };
}

/** Extend either Playwright's test or an existing suite's authenticated/guest test. */
function withTemplateCoverage(test, options = {}) {
    return test.extend({
        templateCoverageOptions: [options, {option: true}],
        context: async ({context, templateCoverageOptions}, use, testInfo) => {
            const coverage = await registerTemplateCoverage(context, {...templateCoverageOptions,
                metadata: {spec: testInfo.file, test: testInfo.titlePath, retry: testInfo.retry,
                    project: testInfo.project.name, worker: testInfo.workerIndex}});
            try { await use(context); } finally { await coverage.stop(); }
        }
    });
}

module.exports = { registerTemplateCoverage, withTemplateCoverage };
