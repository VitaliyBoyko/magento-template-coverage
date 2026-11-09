// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: MIT
// License: see LICENSE in the repository root.

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {analyzeStatements} = require('../lib/statements');
const id = 'a'.repeat(32);

test('malformed surrogate text preserves binding locations during template analysis', () => {
    const source = '\uDC00\uDC00\n<span data-bind="text: title"></span>';
    const result = analyzeStatements(source, id);
    assert.equal(result.statements.length, 1);
    assert.equal(result.statements[0].binding, 'text');
    assert.equal(result.statements[0].start.line, 2);
    assert.ok(result.content.startsWith('\uDC00\uDC00\n'));
    assert.equal(result.content.replace(/\/\*mtc_[^*]+\*\//g, ''), source);
});

test('unterminated nested templates finish analysis without recursive parser overflow', () => {
    const source = '<template>'.repeat(12000);
    const result = analyzeStatements(source, id);
    assert.deepEqual(result.statements, []);
    assert.equal(result.content, source);
});
