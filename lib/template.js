// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: MIT
// License: see LICENSE in the repository root.

"use strict";

const {analyzeStatements} = require('./statements');
const {instrumentInline} = require('./inline-scripts');

function analyzeTemplate(source, id, engine, options) {
    let analysis;
    try { analysis = analyzeStatements(source, id, engine, options); }
    catch (error) {
        if (engine !== 'auto' || !/^(Cannot parse|Unsupported or duplicate binding)/.test(error.message)) throw error;
        analysis = {content: source, statements: [], engines: ['html'],
            executionUnsupported: `${error.message}; binding coverage unavailable. Select the template engine explicitly or fix its expressions.`};
    }
    const inline = instrumentInline(source, id, options);
    let content = analysis.content, cursor = 0;
    for (const replacement of inline.replacements) {
        const offset = content.indexOf(replacement.original, cursor);
        if (offset < 0) throw new Error('Binding instrumentation changed an inline script');
        content = content.slice(0, offset) + replacement.instrumented + content.slice(offset + replacement.original.length);
        cursor = offset + replacement.instrumented.length;
    }
    return {...analysis, content, statements: [...analysis.statements, ...inline.statements],
        functions: inline.functions, branches: inline.branches, scripts: inline.scripts,
        engines: [...new Set([...analysis.engines, ...(inline.scripts.length ? ['inline-script'] : [])])].sort()};
}

module.exports = {analyzeTemplate};
