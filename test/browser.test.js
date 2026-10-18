'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { observeTemplates } = require('../lib/browser');

test('cross-window observation works when dynamic Function construction is blocked', () => {
    const application = vm.createContext({});
    vm.runInContext(`
        this.nativeFunction = Function;
        this.Function = function () { throw new EvalError("CSP blocks dynamic code"); };
        this.window = this;
        this.NodeFilter = { SHOW_COMMENT: 128 };
        this.document = {
            nodeType: 9,
            createTreeWalker(root) {
                const comments = [...(root.comments || [])];
                return { nextNode() { return comments.shift() || null; } };
            }
        };
        this.MutationObserver = class {
            constructor(callback) {
                if (!(callback instanceof globalThis.nativeFunction)) throw new Error('DOM callback belongs to the caller window');
                this.callback = callback;
                this.records = [];
                globalThis.observer = this;
            }
            observe() {}
            takeRecords() { return this.records.splice(0); }
            disconnect() { this.disconnected = true; }
        };
        this.first = { nodeType: 8, nodeValue: 'mtc:' + 'a'.repeat(32) };
        this.second = { nodeType: 8, nodeValue: 'mtc:' + 'b'.repeat(32) };
        document.comments = [first];
    `, application);
    application.document.currentScript = {nonce: 'fixture-nonce'};
    application.document.createElement = () => ({remove() {}});
    application.document.head = {appendChild(script) {
        assert.equal(script.nonce, 'fixture-nonce');
        vm.runInContext(script.textContent, application);
    }};
    const hits = [];
    const collector = observeTemplates(application, id => hits.push(id));

    assert.deepEqual(hits, ['a'.repeat(32)]);
    vm.runInContext('observer.records.push({ addedNodes: [first, second] });', application);
    collector.flush();
    assert.deepEqual(hits, ['a'.repeat(32), 'b'.repeat(32)]);
    collector.disconnect();
    assert.equal(application.observer.disconnected, true);
});
