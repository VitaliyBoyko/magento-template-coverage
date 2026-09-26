'use strict';

const { parse } = require('acorn');

const engines = ['auto', 'knockout', 'underscore', 'jquery-tmpl', 'literal', 'html'];
const { helper } = require('./engines-runtime');
const hit = (template, statement) => `window.${helper}("${template}","${statement}")`;

function detectEngine(source) {
    if (/<%[\s\S]*?%>/.test(source)) return 'underscore';
    if (/\{\{\/?(?:if|else|each|tmpl|wrap|html|=|!)(?:\s|\(|\}\})/.test(source)) return 'jquery-tmpl';
    if (/\$\{/.test(source)) return /\$\{\s*\$\s*[.[]/.test(source) ? 'literal' : 'jquery-tmpl';
    return 'knockout';
}

// Build a JS syntax tree across <% %> boundaries. Literal markup is represented
// by empty statements; only expressions mapped to original code can get hits.
function underscore(source, add, edit) {
    let program = '', cursor = 0;
    const spans = [], interpolations = new Map();
    const append = (code, offset) => {
        const start = program.length;
        program += code;
        spans.push({ start, end: program.length, offset });
        return start;
    };
    const tokens = [...source.matchAll(/<%([=-]?)([\s\S]+?)%>/g)];
    for (const token of tokens) {
        if (token.index > cursor) program += '\n;\n';
        const codeStart = token.index + 2 + token[1].length;
        if (token[1]) {
            program += '\n__mtcOutput(('; // synthetic; never emitted into the template
            const start = append(token[2], codeStart);
            interpolations.set(start, { token, end: program.length });
            program += '\n));\n';
        } else {
            program += '\n';
            append(token[2], codeStart);
            program += '\n';
        }
        cursor = token.index + token[0].length;
    }
    let ast;
    try { ast = parse(program, { ecmaVersion: 'latest', allowReturnOutsideFunction: true }); }
    catch (error) { throw new Error(`Cannot parse Underscore evaluation code: ${error.message}`); }
    const offset = (position, end = false) => {
        const span = spans.find(s => position >= s.start && (end ? position <= s.end : position < s.end));
        return span ? span.offset + position - span.start : undefined;
    };
    const wrapped = new Set();
    const wrap = (node, label, syntax = 'underscore:evaluate', start) => {
        if (!node || wrapped.has(node)) return;
        const a = offset(node.start), b = offset(node.end, true);
        if (a === undefined || b === undefined) return;
        wrapped.add(node);
        const call = add(label, syntax, start ?? a, b);
        edit(a, `(${call},(`);
        edit(b, '))');
    };
    const visit = node => {
        if (!node || typeof node.type !== 'string') return;
        if (node.type === 'ExpressionStatement') {
            const expression = node.expression;
            if (expression.type === 'CallExpression' && expression.callee.name === '__mtcOutput') {
                const argument = expression.arguments[0];
                const interpolation = [...interpolations].find(([a, data]) => argument.start >= a && argument.end <= data.end)?.[1];
                if (interpolation) {
                    wrap(argument, interpolation.token[1] === '-' ? 'escape' : 'interpolate',
                        `underscore:${interpolation.token[1] === '-' ? 'escape' : 'interpolate'}`, interpolation.token.index);
                }
            } else if (!node.directive) wrap(expression, 'evaluate');
        }
        if (node.type === 'VariableDeclarator') wrap(node.init, 'initialize');
        if (['IfStatement', 'WhileStatement', 'DoWhileStatement', 'ForStatement', 'ConditionalExpression'].includes(node.type)) wrap(node.test, 'condition');
        if (node.type === 'ForStatement') {
            if (node.init?.type !== 'VariableDeclaration') wrap(node.init, 'initialize');
            wrap(node.update, 'update');
        }
        if (['ForInStatement', 'ForOfStatement'].includes(node.type)) wrap(node.right, 'iterate');
        if (['ReturnStatement', 'ThrowStatement'].includes(node.type)) wrap(node.argument, node.type === 'ReturnStatement' ? 'return' : 'throw');
        if (node.type === 'SwitchStatement') wrap(node.discriminant, 'switch');
        if (node.type === 'SwitchCase') wrap(node.test, 'case');
        for (const [key, value] of Object.entries(node)) {
            if (key === 'type') continue;
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === 'object') visit(value);
        }
    };
    visit(ast);
}

// Follow the legacy engine's own token grammar. Counters are separate tags,
// leaving its function auto-invocation, null checks, escaping and item context intact.
function jquery(source, add, edit) {
    const pattern = /\$\{([^}]*)\}|\{\{(\/?)(\w+|.)(?:\(((?:[^}]|}(?!}))*?)?\))?(?:\s+(.*?)?)?(\(((?:[^}]|}(?!}))*?)\))?\s*\}\}/g;
    const supported = new Set(['if', 'else', 'each', 'tmpl', 'wrap', 'html', '=', '!']);
    for (const match of source.matchAll(pattern)) {
        const type = match[1] !== undefined ? '=' : match[3];
        if (!supported.has(type)) throw new Error(`Unsupported jQuery template tag: ${type}`);
        if (match[2] || type === '!') continue;
        const call = add(type === '=' ? 'interpolate' : type, `jquery-tmpl:${type}`, match.index, match.index + match[0].length);
        const marker = `{{mtc ${call}}}`;
        // An else declaration belongs to its branch; preceding it would count
        // execution of the previous branch and may make the generated JS invalid.
        edit(type === 'else' ? match.index + match[0].length : match.index, marker);
    }
}

function literal(source, add, edit) {
    let ast;
    try { ast = parse('`' + source + '`', { ecmaVersion: 'latest' }); }
    catch (error) { throw new Error(`Cannot parse Magento template literal: ${error.message}. Use --engine for another template language.`); }
    const template = ast.body[0]?.expression;
    if (template?.type !== 'TemplateLiteral' || ast.body.length !== 1) throw new Error('Invalid Magento template literal');
    for (const expression of template.expressions) {
        const start = expression.start - 1, end = expression.end - 1;
        const call = add('interpolate', 'literal:interpolate', start, end);
        edit(start, `(${call},(`);
        edit(end, '))');
    }
}

module.exports = { engines, helper, hit, detectEngine, underscore, jquery, literal };
