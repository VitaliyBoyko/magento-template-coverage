'use strict';

const { parseFragment } = require('parse5');
const { parse } = require('acorn');
const { decodeHTMLAttribute } = require('entities');

const attributes = Object.fromEntries([
    'css', 'attr', 'html', 'with', 'text', 'click', 'event', 'submit', 'enable', 'disable',
    'options', 'visible', 'template', 'hasFocus', 'textInput', 'component', 'uniqueName',
    'optionsText', 'optionsValue', 'checkedValue', 'selectedOptions', 'if', 'ifnot',
    'repeat', 'range', 'resizable', 'keyboard', 'autoselect', 'tooltip', 'afterRender',
    'bindHtml', 'outerClick', 'collapsible', 'openCollapsible', 'closeCollapsible',
    'toggleCollapsible', 'staticChecked', 'simpleChecked', 'colorPicker'
].map(name => [name.toLowerCase(), name]));
Object.assign(attributes, {
    innerif: 'if', innerifnot: 'ifnot', outereach: 'foreach', each: 'foreach',
    'ko-value': 'value', 'ko-style': 'style', 'ko-checked': 'checked', 'ko-disabled': 'disable',
    'ko-focused': 'hasFocus', 'ko-scope': 'scope', 'simple-checked': 'simpleChecked',
    outerfasteach: 'fastForEach', render: 'template', translate: 'i18n'
});
const nodes = { if: 'if', text: 'text', with: 'with', scope: 'scope', ifnot: 'ifnot',
    each: 'foreach', component: 'component', render: 'template', repeat: 'repeat',
    fastforeach: 'fastForEach', translate: 'i18n' };

// Map decoded attribute offsets back to the original file, including entities and CRLF.
function decodeWithOffsets(raw, start) {
    let value = '';
    const offsets = [];
    for (let index = 0; index < raw.length;) {
        let length = 1;
        let text = raw[index];
        if (text === '&') {
            const match = /^&(?:#[xX][\da-fA-F]+;?|#\d+;?|[a-zA-Z][\da-zA-Z]*;?)/.exec(raw.slice(index));
            if (match) {
                const candidate = match[0];
                // Named references without a semicolon followed by '=' remain literal in attributes.
                if (!(raw[index + candidate.length] === '=' && !candidate.endsWith(';') && candidate[1] !== '#')) {
                    const decoded = decodeHTMLAttribute(candidate);
                    if (decoded !== candidate) { text = decoded; length = candidate.length; }
                }
            }
        } else if (text === '\r') { text = '\n'; length = raw[index + 1] === '\n' ? 2 : 1; }
        else if (text === '\0') text = '\uFFFD';
        for (let part = 0; part < text.length; part++) offsets.push(start + index);
        value += text;
        index += length;
    }
    offsets.push(start + raw.length);
    return { value, offsets };
}

function analyzeStatements(source, templateId) {
    const statements = [];
    const edits = [];
    // Underscore can generate bindings dynamically. Preserve its DOM metric; never guess executed lines.
    if (/<%[\s\S]*?%>/.test(source)) {
        return { statements, content: source, executionUnsupported: 'Underscore-generated template; DOM coverage only' };
    }
    const location = offset => {
        const before = source.slice(0, offset).split(/\r\n|\r|\n/);
        return { line: before.length, column: before.at(-1).length };
    };
    const add = (binding, syntax, start, end, insertion, suffix = '') => {
        const id = String(statements.length);
        const marker = `/*mtc_${templateId}_${id}_${Buffer.from(binding).toString('hex')}*/`;
        statements.push({ id, binding, syntax, start: location(start), end: location(end) });
        edits.push({ offset: insertion, text: marker + suffix });
    };
    const bindings = (value, offsets, syntax) => {
        let object;
        try { object = parse(`({${value}\n})`, { ecmaVersion: 'latest' }).body[0].expression; }
        catch (error) { throw new Error(`Cannot parse ${syntax} at line ${location(offsets[0]).line}: ${error.message}`); }
        const keys = new Set();
        for (const property of object.properties) {
            const key = property.key?.name ?? property.key?.value;
            if (property.type !== 'Property' || property.computed || property.shorthand || property.method ||
                property.kind !== 'init' || typeof key !== 'string' || keys.has(key)) {
                throw new Error(`Unsupported or duplicate binding at line ${location(offsets[0]).line}`);
            }
            keys.add(key);
            add(key, syntax, offsets[property.key.start - 2], offsets[property.value.end - 2], offsets[property.value.start - 2]);
        }
    };
    const attributeValue = (node, attribute) => {
        const span = node.sourceCodeLocation.attrs[attribute.name];
        const raw = source.slice(span.startOffset, span.endOffset);
        const match = /^[^\s=]+\s*=\s*(["']?)/.exec(raw);
        if (!match) return { value: '', offsets: [span.endOffset], span, missing: true };
        const quote = match[1];
        const end = quote ? raw.length - 1 : raw.length;
        const decoded = decodeWithOffsets(raw.slice(match[0].length, end), span.startOffset + match[0].length);
        if (decoded.value !== attribute.value) throw new Error(`Cannot map attribute at line ${span.startLine}`);
        return { ...decoded, span };
    };
    const shorthand = (node, attribute, binding, syntax, isRender) => {
        const data = attribute ? attributeValue(node, attribute) : {
            value: '', offsets: [node.sourceCodeLocation.startTag.endOffset - 1], missing: true
        };
        if (data.missing) {
            if (!isRender) throw new Error(`Missing binding expression at line ${node.sourceCodeLocation.startLine}`);
            const offset = !attribute && source[data.offsets[0] - 1] === '/' ? data.offsets[0] - 1 : data.offsets[0];
            const name = attribute ? '' : ' args';
            const id = String(statements.length);
            const marker = `/*mtc_${templateId}_${id}_${Buffer.from(binding).toString('hex')}*/`;
            statements.push({ id, binding, syntax, start: location(attribute ? data.span.startOffset : node.sourceCodeLocation.startOffset), end: location(offset) });
            edits.push({ offset, text: `${name}="${marker}getTemplate()"` });
        } else {
            add(binding, syntax, data.span.startOffset, data.span.endOffset, data.offsets[0],
                isRender && !data.value ? 'getTemplate()' : '');
        }
    };
    const visit = node => {
        if (node.nodeName === '#comment' && /^\s*ko\s+/.test(node.data)) {
            const span = node.sourceCodeLocation;
            const raw = source.slice(span.startOffset, span.endOffset);
            const prefix = /^<!--\s*ko\s+/.exec(raw)[0].length;
            const value = raw.slice(prefix, -3);
            bindings(value, Array.from({ length: value.length + 1 }, (_, i) => span.startOffset + prefix + i), 'ko-comment');
        }
        if (node.tagName && node.sourceCodeLocation) {
            for (const attribute of node.attrs || []) {
                if (attribute.name === 'data-bind') {
                    const data = attributeValue(node, attribute);
                    bindings(data.value, data.offsets, 'data-bind');
                } else if (attributes[attribute.name]) {
                    shorthand(node, attribute, attributes[attribute.name], `magento-attribute:${attribute.name}`, attribute.name === 'render');
                }
            }
            if (nodes[node.tagName]) {
                shorthand(node, node.attrs.find(attribute => attribute.name === 'args'), nodes[node.tagName],
                    `magento-node:${node.tagName}`, node.tagName === 'render');
            }
        }
        // These bodies are inert/raw-text, not binding declarations in this template's context.
        if (!['script', 'style', 'textarea', 'template'].includes(node.tagName)) {
            for (const child of node.childNodes || []) visit(child);
        }
    };
    visit(parseFragment(source, { sourceCodeLocationInfo: true }));
    let content = source;
    for (const edit of edits.sort((a, b) => b.offset - a.offset)) {
        content = content.slice(0, edit.offset) + edit.text + content.slice(edit.offset);
    }
    return { statements, content };
}

module.exports = { analyzeStatements };
