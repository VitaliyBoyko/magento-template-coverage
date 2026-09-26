'use strict';

const { parseFragment } = require('parse5');
const { parse } = require('acorn');
const { decodeHTMLAttribute } = require('entities');
const { engines, hit, detectEngine, underscore, jquery, literal } = require('./engines');

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

function analyzeBindings(source, templateId, register, edit, masked = source) {
    const location = offset => {
        const before = source.slice(0, offset).split(/\r\n|\r|\n/);
        return { line: before.length, column: before.at(-1).length };
    };
    const add = (binding, syntax, start, end, insertion, suffix = '') => {
        const id = register(binding, syntax, start, end);
        const marker = `/*mtc_${templateId}_${id}_${Buffer.from(binding).toString('hex')}*/`;
        edit(insertion, marker + suffix);
    };
    const bindings = (value, offsets, syntax) => {
        let object;
        try { object = parse(`({${value}\n})`, { ecmaVersion: 'latest' }).body[0].expression; }
        catch (error) { throw new Error(`Cannot parse ${syntax} at line ${location(offsets[0]).line}: ${error.message}`); }
        const keys = new Set();
        for (const property of object.properties) {
            const key = property.key?.name ?? property.key?.value;
            if (property.type !== 'Property' || property.computed || property.method ||
                property.kind !== 'init' || typeof key !== 'string' || keys.has(key)) {
                throw new Error(`Unsupported or duplicate binding at line ${location(offsets[0]).line}`);
            }
            keys.add(key);
            if (property.shorthand) {
                edit(offsets[property.key.end - 2], ': ');
                add(key, syntax, offsets[property.key.start - 2], offsets[property.key.end - 2],
                    offsets[property.key.end - 2], 'void 0');
                continue;
            }
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
            const offset = !attribute && source[data.offsets[0] - 1] === '/' ? data.offsets[0] - 1 : data.offsets[0];
            const name = attribute ? '' : ' args';
            const id = register(binding, syntax, attribute ? data.span.startOffset : node.sourceCodeLocation.startOffset, offset);
            const marker = `/*mtc_${templateId}_${id}_${Buffer.from(binding).toString('hex')}*/`;
            edit(offset, `${name}="${marker}${isRender ? 'getTemplate()' : 'void 0'}"`);
        } else {
            add(binding, syntax, data.span.startOffset, data.span.endOffset, data.offsets[0],
                !data.value ? (isRender ? 'getTemplate()' : 'void 0') : '');
        }
    };
    const visit = node => {
        if (node.nodeName === '#comment' && /^\s*ko\s+/.test(node.data)) {
            const span = node.sourceCodeLocation;
            const raw = source.slice(span.startOffset, span.endOffset);
            const prefix = /^<!--\s*ko\s+/.exec(raw)[0].length;
            const value = raw.slice(prefix, -3);
            if (/<%|\$\{|\{\{/.test(value)) return;
            bindings(value, Array.from({ length: value.length + 1 }, (_, i) => span.startOffset + prefix + i), 'ko-comment');
        }
        if (node.tagName && node.sourceCodeLocation) {
            for (const attribute of node.attrs || []) {
                if (attribute.name !== 'data-bind' && !attributes[attribute.name]) continue;
                const span = node.sourceCodeLocation.attrs[attribute.name];
                if (/<%|\$\{|\{\{/.test(source.slice(span.startOffset, span.endOffset))) continue;
                if (attribute.name === 'data-bind') {
                    const data = attributeValue(node, attribute);
                    bindings(data.value, data.offsets, 'data-bind');
                } else if (attributes[attribute.name]) {
                    shorthand(node, attribute, attributes[attribute.name], `magento-attribute:${attribute.name}`, attribute.name === 'render');
                }
            }
            const args = node.attrs.find(attribute => attribute.name === 'args');
            const argsSpan = args && node.sourceCodeLocation.attrs.args;
            if (nodes[node.tagName] && !(argsSpan && /<%|\$\{|\{\{/.test(source.slice(argsSpan.startOffset, argsSpan.endOffset)))) {
                shorthand(node, node.attrs.find(attribute => attribute.name === 'args'), nodes[node.tagName],
                    `magento-node:${node.tagName}`, node.tagName === 'render');
            }
        }
        // These bodies are inert/raw-text, not binding declarations in this template's context.
        if (!['script', 'style', 'textarea', 'template'].includes(node.tagName)) {
            for (const child of node.childNodes || []) visit(child);
        }
    };
    visit(parseFragment(masked, { sourceCodeLocationInfo: true }));
}

function analyzeStatements(source, templateId, requested = 'auto') {
    if (!engines.includes(requested)) throw new Error(`Unsupported template engine: ${requested}`);
    if (requested === 'html') return { statements: [], content: source, engines: ['html'] };
    const statements = [], edits = [], used = new Set();
    const location = offset => {
        const before = source.slice(0, offset).split(/\r\n|\r|\n/);
        return { line: before.length, column: before.at(-1).length };
    };
    const region = (content, base, engine) => {
        // Inline templates are inert until consumed. Map their bodies separately
        // so merely inserting a script/template element cannot claim execution.
        const nested = [];
        const tree = parseFragment(content, { sourceCodeLocationInfo: true });
        const find = node => {
            const type = node.attrs?.find(a => a.name === 'type')?.value.toLowerCase();
            const inline = node.tagName === 'template' || (node.tagName === 'script' &&
                ['text/html', 'text/x-magento-template', 'text/x-jquery-tmpl', 'text/x-template'].includes(type));
            const span = node.sourceCodeLocation;
            if (inline && span?.startTag && span.endTag) {
                nested.push({ start: span.startTag.endOffset, end: span.endTag.startOffset,
                    engine: type === 'text/x-jquery-tmpl' ? 'jquery-tmpl' : 'auto' });
                return;
            }
            // Executable JS, CSS and textareas are not separate HTML templates.
            if (!['script', 'style', 'textarea'].includes(node.tagName)) (node.childNodes || []).forEach(find);
        };
        find(tree);
        let masked = content;
        for (const child of nested) masked = masked.slice(0, child.start) +
            masked.slice(child.start, child.end).replace(/[^\r\n]/g, ' ') + masked.slice(child.end);
        const selected = engine === 'auto' ? detectEngine(masked) : engine;
        used.add(selected);
        const register = (binding, syntax, start, end) => {
            const id = String(statements.length);
            statements.push({ id, binding, syntax, start: location(base + start), end: location(base + end) });
            return id;
        };
        const add = (...args) => hit(templateId, register(...args));
        const edit = (offset, text) => edits.push({ offset: base + offset, text });
        if (selected === 'underscore') underscore(masked, add, edit);
        if (selected === 'jquery-tmpl') jquery(masked, add, edit);
        if (selected === 'literal') literal(masked, add, edit);
        // Engine tokens can contain markup and quotes, so hide them from the HTML
        // parser. Dynamic generated binding declarations are explicitly excluded.
        const html = masked.replace(/<%[\s\S]*?%>|\{\{[\s\S]*?\}\}|\$\{[^}]*\}/g,
            token => token.replace(/[^\r\n]/g, ' '));
        if (selected !== 'html') analyzeBindings(content, templateId, register, edit, html);
        for (const child of nested) region(content.slice(child.start, child.end), base + child.start, child.engine);
    };
    region(source, 0, requested);
    let content = source;
    // At an identical offset, later (inner) AST insertions must appear inside
    // earlier wrappers. Reverse insertion order when applying edits backwards.
    for (const edit of edits.map((edit, order) => ({ ...edit, order })).sort((a, b) => b.offset - a.offset || b.order - a.order)) {
        content = content.slice(0, edit.offset) + edit.text + content.slice(edit.offset);
    }
    return { statements, content, engines: [...used].sort() };
}

module.exports = { analyzeStatements };
