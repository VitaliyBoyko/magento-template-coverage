'use strict';

const {parseFragment} = require('parse5');
const {parse} = require('acorn');
const {decodeHTMLAttribute} = require('entities');
const PhpParser = require('php-parser');
const {hit} = require('./engines');

// Tokenize PHP instead of treating ?> in strings, comments and heredocs as HTML.
// Keep offsets/newlines identical so reports always point into original PHTML.
function maskPhp(source) {
    let masked = '', offset = 0, open = -1;
    const ranges = [];
    for (const token of new PhpParser().tokenGetAll(source)) {
        const text = Array.isArray(token) ? token[1] : token;
        const type = Array.isArray(token) ? token[0] : '';
        if (type === 'T_OPEN_TAG' || type === 'T_OPEN_TAG_WITH_ECHO') open = offset;
        masked += type === 'T_INLINE_HTML' ? text : text.replace(/[^\r\n]/g, ' ');
        offset += text.length;
        if (type === 'T_CLOSE_TAG') { ranges.push([open, offset]); open = -1; }
    }
    if (open >= 0) ranges.push([open, offset]);
    if (offset !== source.length) throw new Error('Cannot map PHP template tokens');
    return {masked, ranges};
}

const expressionDirectives = new Set(['data', 'text', 'html', 'html-safe', 'show', 'if', 'bind', 'init', 'on', 'for', 'model']);

function analyzeAlpine(source, templateId, {phtml = false, register, edit} = {}) {
    const {masked, ranges} = phtml ? maskPhp(source) : {masked: source, ranges: []};
    const tree = parseFragment(masked, {sourceCodeLocationInfo: true});
    const statements = [], edits = [], unsupported = [];
    const location = offset => {
        const lines = source.slice(0, offset).split(/\r\n|\r|\n/);
        return {line: lines.length, column: lines.at(-1).length};
    };
    const visit = node => {
        const scoped = [];
        let markerOffset;
        for (const attribute of node.attrs || []) {
            const name = attribute.name;
            const directive = name.startsWith('@') ? 'on' : name.startsWith(':') ? 'bind'
                : name.match(/^x-([\w-]+)/)?.[1];
            if (!expressionDirectives.has(directive)) continue;
            // :key is evaluated in x-for's generated loop scope, not on its own.
            const span = node.sourceCodeLocation?.attrs?.[name];
            if (!span) continue;
            const raw = source.slice(span.startOffset, span.endOffset);
            const match = /^[^\s=]+\s*=\s*(["'])/.exec(raw);
            if (!match) { unsupported.push(`Unquoted Alpine directive ${name} at line ${span.startLine}`); continue; }
            const start = span.startOffset + match[0].length;
            const end = span.endOffset - 1;
            let expression = source.slice(start, end);
            if (!expression.trim()) continue;
            let validation = masked.slice(start, end);
            for (const [from, to] of ranges) {
                if (from >= start && to <= end) {
                    const relative = from - start;
                    validation = validation.slice(0, relative) + '0' + validation.slice(relative + 1);
                }
            }
            validation = decodeHTMLAttribute(validation);
            let from = start, to = end, kind = 'expression';
            if (directive === 'for') {
                const loop = /^(.*?)\s+(?:in|of)\s+([\s\S]+)$/.exec(validation);
                if (!loop) { unsupported.push(`Cannot map Alpine x-for at line ${span.startLine}`); continue; }
                // The collection's raw span is located without decoding its entities.
                const rawLoop = /^(.*?)\s+(?:in|of)\s+([\s\S]+)$/.exec(expression);
                if (!rawLoop) { unsupported.push(`Cannot map Alpine x-for at line ${span.startLine}`); continue; }
                from = end - rawLoop[2].length;
                expression = rawLoop[2]; validation = loop[2];
            }
            let ast;
            try {
                ast = parse(`(${validation}\n)`, {ecmaVersion: 'latest', allowAwaitOutsideFunction: true}).body[0].expression;
            } catch (error) {
                if (['init', 'on'].includes(directive)) {
                    try { parse(validation, {ecmaVersion: 'latest', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true}); kind = 'body'; }
                    catch { unsupported.push(`Cannot parse Alpine ${name} at line ${span.startLine}`); continue; }
                } else { unsupported.push(`Cannot parse Alpine ${name} at line ${span.startLine}`); continue; }
            }
            if (directive === 'model' && (!['Identifier', 'MemberExpression'].includes(ast?.type) || /[\r\n]|<\?/.test(expression))) {
                unsupported.push(`Unsupported dynamic/multiline Alpine x-model at line ${span.startLine}`); continue;
            }
            if (directive === 'model' && node.attrs.some(attribute => [':type', 'x-bind:type', ':name', 'x-bind:name'].includes(attribute.name))) {
                unsupported.push(`Dynamic input type/name for Alpine x-model at line ${span.startLine}`); continue;
            }
            const id = register ? register(name, `alpine:${directive}`, span.startOffset, span.endOffset) : String(statements.length);
            statements.push({id, binding: name, syntax: `alpine:${directive}`, start: location(span.startOffset), end: location(span.endOffset)});
            // Escape only inserted text, leaving the source's PHP and entities intact.
            const encode = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
            // Property paths are valid in both Alpine evaluators. A scope getter
            // counts access and returns the evaluator's complete scope, including
            // data providers, loop locals, event parameters and magic properties.
            const propertyPath = ranges.reduceRight((text, [start, end]) => start >= from && end <= to
                ? text.slice(0, start - from) + '0' + text.slice(end - from) : text, expression);
            if (/^[$A-Z_a-z][$\w]*(?:\.[$A-Z_a-z][$\w]*)*$/.test(decodeHTMLAttribute(propertyPath))) {
                scoped.push(id);
                markerOffset ??= span.endOffset;
                edits.push({offset: from, text: `__mtc_${templateId}_${id}.`});
                if (directive === 'model' && node.attrs.some(attribute => attribute.name === 'type' && attribute.value === 'radio') && !node.attrs.some(attribute => attribute.name === 'name')) {
                    edits.push({offset: span.endOffset, text: ` name="${encode(decodeHTMLAttribute(expression))}"`});
                }
                continue;
            }
            const counter = hit(templateId, id);
            let prefix = `(${counter},(`, suffix = '))';
            if (kind === 'body') {
                prefix = `${counter};`; suffix = '';
            }
            if (directive === 'model') {
                // Keep an assignable member expression: Alpine compiles both a
                // getter and an assignment, even when a model's value is an object.
                if (node.attrs.some(attribute => attribute.name === 'type' && attribute.value === 'radio') && !node.attrs.some(attribute => attribute.name === 'name')) {
                    edits.push({offset: span.endOffset, text: ` name="${encode(decodeHTMLAttribute(expression))}"`});
                }
                const parameter = `__mtcValue_${templateId}`;
                prefix = `({get value(){${counter};return (`;
                const suffixStart = `)},set value(${parameter}){`;
                edits.push({offset: from, text: encode(prefix)});
                edits.push({offset: to, text: encode(suffixStart) + expression + encode(`=${parameter}}}).value`)});
            } else {
                edits.push({offset: from, text: encode(prefix)}, {offset: to, text: encode(suffix)});
            }
        }
        if (scoped.length) {
            if (node.attrs.some(attribute => attribute.name === 'x-mtc')) throw new Error('The Alpine directive x-mtc is reserved for template coverage');
            edits.push({offset: markerOffset, text: ` x-mtc="${templateId}:${scoped.join(',')}"`});
        }
        if (!['script', 'style', 'textarea'].includes(node.tagName)) {
            for (const child of node.childNodes || []) visit(child);
            if (node.content) visit(node.content);
        }
    };
    visit(tree);
    if (edit) for (const insertion of edits) edit(insertion.offset, insertion.text);
    let content = source;
    for (const edit of edits.sort((a, b) => b.offset - a.offset)) content = content.slice(0, edit.offset) + edit.text + content.slice(edit.offset);
    return {statements, content, engines: ['alpine'], unsupported};
}

module.exports = {analyzeAlpine, maskPhp};
