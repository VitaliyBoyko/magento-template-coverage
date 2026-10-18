'use strict';

const {hit} = require('./engines');
const PhpParser = require('php-parser');
const {parseFragment} = require('parse5');
const babel = require('@babel/core');
const generate = require('@babel/generator').default;
const {programVisitor} = require('istanbul-lib-instrument');
const {traceGeneratedOutput} = require('./generated-scripts');

// Parse PHP tokens rather than matching tags with a regexp: quoted ?>, comments
// and heredocs must never be mistaken for the end of an island.
function phpIslands(source) {
    const islands = [];
    let offset = 0, start = null;
    for (const token of new PhpParser().tokenGetAll(source)) {
        const text = Array.isArray(token) ? token[1] : token;
        const type = Array.isArray(token) ? token[0] : '';
        if (type === 'T_OPEN_TAG' || type === 'T_OPEN_TAG_WITH_ECHO') start = offset;
        offset += text.length;
        if (type === 'T_CLOSE_TAG' && start !== null) {
            // PHP's closing token includes the following newline. Keep that
            // newline in JavaScript so // comments and ASI retain their meaning.
            const end = offset - (text.match(/(?:\r\n|\n|\r)$/)?.[0].length || 0);
            islands.push({start, end, text: source.slice(start, end)});
            start = null;
        }
    }
    if (start !== null) islands.push({start, end: offset, text: source.slice(start)});
    return islands;
}

function placeholderSource(source, islands, start, end, choices = new Map(), semicolons = new Set()) {
    let code = '', cursor = start;
    const segments = [];
    const append = (text, from, to, island = false, structural = false) => {
        if (!island) for (const offset of semicolons) if (offset >= from && offset < to) text = text.slice(0, offset - from) + ' ' + text.slice(offset - from + 1);
        segments.push({start: code.length, end: code.length + text.length, from, to, island, structural});
        code += text;
    };
    for (const [index, island] of islands.entries()) {
        if (island.start < start || island.end > end) continue;
        append(source.slice(cursor, island.start), cursor, island.start);
        const echo = /^<\?=|^<\?php\s+(?:echo|print)\b/i.test(island.text);
        append(choices.get(island.start) ?? (echo ? `__mtc_php_${index}__` : island.text.replace(/[^\r\n]/g, ' ')), island.start, island.end, true, choices.has(island.start));
        cursor = island.end;
    }
    append(source.slice(cursor, end), cursor, end);
    function originalOffset(offset, side = 'start') {
        const segment = segments.find(entry => offset >= entry.start && offset < entry.end);
        if (!segment) return end;
        if (segment.structural) return side === 'end' && offset !== segment.start ? segment.to : segment.from;
        if (!segment.island || segment.end - segment.start === segment.to - segment.from) return segment.from + offset - segment.start;
        // Nodes may surround a PHP value, but may not split the placeholder.
        if (offset !== segment.start) throw new Error('JavaScript syntax splits a PHP expression');
        return segment.from;
    }
    return {code, originalOffset};
}

function parseScript(source, islands, start, end, options) {
    const parse = (choices, semicolons) => {
        const prepared = placeholderSource(source, islands, start, end, choices, semicolons);
        return {...prepared, ast: babel.parseSync(prepared.code, options)};
    };
    let original, originalError;
    try { original = parse(new Map()); } catch (error) { originalError = error; }
    // PHP can select an initializer: `const x = <?php if ... ?> value
    // <?php else: ?> otherValue <?php endif; ?>`. Represent those islands
    // as a conditional only for parsing. Their original PHP is retained in
    // the output and their server-side branches receive no JS counters.
    const stack = [], groups = [];
    for (const island of islands.filter(entry => entry.start >= start && entry.end <= end)) {
        const tokens = new PhpParser().tokenGetAll(island.text).filter(token => !Array.isArray(token)
            || !['T_OPEN_TAG', 'T_CLOSE_TAG', 'T_WHITESPACE', 'T_COMMENT', 'T_DOC_COMMENT'].includes(token[0]));
        const first = Array.isArray(tokens[0]) ? tokens[0][0] : tokens[0];
        if (first === 'T_IF' && tokens.at(-1) === ':') stack.push({begin: island});
        else if (first === 'T_ELSEIF' && stack.length) stack.at(-1).unsupported = true;
        else if (first === 'T_ELSE' && tokens.length === 2 && tokens[1] === ':' && stack.length) stack.at(-1).alternate = island;
        else if (first === 'T_ENDIF' && tokens.length <= 2 && stack.length) {
            const group = {...stack.pop(), end: island};
            if (group.alternate && !group.unsupported) groups.push(group);
        }
    }
    // ASI can make two alternative values parse as a declaration plus a labeled
    // block. Check every candidate, including candidates that fix a syntax error.
    function crossings(parsed) {
        const crossing = new Set();
        babel.types.traverseFast(parsed.ast, node => {
            if (!babel.types.isStatement(node)) return;
            const effectiveEnd = node.expression?.end ?? node.declarations?.at(-1)?.end ?? node.argument?.end ?? node.end;
            const from = parsed.originalOffset(node.start), to = parsed.originalOffset(effectiveEnd, 'end');
            for (const group of groups) if (from < group.begin.start && to > group.begin.end && to < group.end.end) crossing.add(group);
        });
        return crossing;
    }
    let candidates = groups;
    if (original) {
        const crossing = crossings(original);
        if (!crossing.size) return original;
        candidates = [...crossing];
        originalError = new Error('PHP conditional crosses a JavaScript statement boundary');
    }
    const selections = [...(candidates.length > 1 ? [candidates] : []), ...candidates.map(group => [group])];
    for (const selection of selections) {
        const choices = new Map(), semicolons = new Set();
        for (const group of selection) {
            choices.set(group.begin.start, `(__mtc_choice_${group.begin.start}__?`);
            choices.set(group.alternate.start, ':');
            choices.set(group.end.start, ')');
            for (const boundary of [group.alternate.start, group.end.start]) {
                const prefix = source.slice(0, boundary).trimEnd();
                if (prefix.endsWith(';')) semicolons.add(prefix.length - 1);
            }
        }
        try {
            const parsed = parse(choices, semicolons);
            if (!crossings(parsed).size) return parsed;
        } catch { /* Preserve the first useful syntax diagnostic. */ }
    }
    // PHP can also select whole declarations with the same lexical name.
    // Separate their parse-time scopes without adding browser-side branches.
    for (const selection of selections) {
        const choices = new Map();
        for (const group of selection) {
            choices.set(group.begin.start, `if(__mtc_statements_${group.begin.start}_${group.alternate.start}_${group.end.start}__){`);
            choices.set(group.alternate.start, '}else{');
            choices.set(group.end.start, '}');
        }
        try {
            const parsed = parse(choices);
            if (!crossings(parsed).size) return parsed;
        } catch { /* Preserve the original diagnostic for unsupported PHP shapes. */ }
    }
    throw originalError;
}

// Istanbul supplies the counters and coverage maps. Replay only its AST edits
// against the original text; never regenerate PHP, strings, comments or layout.
// This preserves PHP execution and every source newline used by PCOV.
function instrumentScript(source, islands, start, end, filename, module, templateId, scriptId) {
    const parserOptions = {configFile: false, babelrc: false, sourceType: module ? 'module' : 'script', parserOpts: {createParenthesizedExpressions: true}};
    const {ast, originalOffset} = parseScript(source, islands, start, end, parserOptions);
    const snapshots = new WeakMap(), generated = [], traced = new Map(), serverBlocks = new WeakMap();
    const lineStarts = [0];
    for (let index = 0; index < source.length; index++) if (source[index] === '\n' || source[index] === '\r' && source[index + 1] !== '\n') lineStarts.push(index + 1);
    const position = offset => {
        let lo = 0, hi = lineStarts.length;
        while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid; }
        return {line: lo + 1, column: offset - lineStarts[lo]};
    };
    function snapshot(node) {
        if (!node || snapshots.has(node)) return;
        const opaque = node.type === 'ExpressionStatement' && node.expression.type === 'Identifier' && /^__mtc_php_\d+__$/.test(node.expression.name);
        const serverIf = node.type === 'IfStatement' && /^__mtc_statements_(\d+)_(\d+)_(\d+)__$/.exec(node.test.name || '');
        if (serverIf) {
            const [begin, alternate, end] = serverIf.slice(1).map(offset => islands.find(island => island.start === Number(offset)));
            serverBlocks.set(node.consequent, {start: begin.end, end: alternate.start});
            serverBlocks.set(node.alternate, {start: alternate.end, end: end.start});
        }
        const serverChoice = node.type === 'ConditionalExpression' && node.test.type === 'Identifier' && /^__mtc_choice_\d+__$/.test(node.test.name);
        const keys = babel.types.VISITOR_KEYS[node.type] || [];
        const children = Object.fromEntries(keys.map(key => [key, Array.isArray(node[key]) ? [...node[key]] : node[key]]));
        if (node.start !== undefined) {
            const serverBlock = serverBlocks.get(node);
            node.start = serverBlock?.start ?? originalOffset(node.start);
            node.end = serverBlock?.end ?? originalOffset(node.end, 'end');
            node.loc = {start: position(node.start), end: position(node.end)};
            if (opaque) {
                const id = `${scriptId}:g:${generated.length}`;
                const island = islands.find(item => item.start === node.start);
                const replacement = island && traceGeneratedOutput(island.text, templateId, id);
                if (replacement) traced.set(island.start, {end: island.end, replacement});
                generated.push({id, line: node.loc.start.line, tracked: !!replacement,
                    reason: replacement ? 'PHP output has not been observed; child-template attribution is unresolved.' : 'This PHP output expression cannot be traced; JavaScript source attribution is unresolved.'});
                node.loc = null;
            }
            if (serverChoice || serverIf || serverBlock) node.loc = null;
        }
        snapshots.set(node, {start: node.start, end: node.end, children});
        for (const child of Object.values(children).flat()) snapshot(child);
    }
    snapshot(ast);
    let coverage, coverageName;
    babel.traverse(ast, {Program(program) {
        const visitor = programVisitor(babel.types, filename, {coverageGlobalScope: 'window', coverageGlobalScopeFunc: false});
        visitor.enter(program);
        program.traverse({VariableDeclarator(declaration) {
            const init = declaration.get('init');
            if (init.node?.type !== 'SequenceExpression') return;
            const value = init.node.expressions.at(-1);
            if (value.type !== 'ParenthesizedExpression' || value.expression.type !== 'ConditionalExpression'
                || !/^__mtc_choice_\d+__$/.test(value.expression.test.name || '')) return;
            const statement = declaration.parentPath;
            if (!statement.isVariableDeclaration() || !statement.inList) throw new Error('PHP-selected initializers in loop headers are unsupported');
            // Each PHP branch may already terminate the declaration with a
            // semicolon. Hoisting avoids wrapping those semicolons in a JS
            // comma expression and preserves inferred function/class names.
            statement.insertBefore(init.node.expressions.slice(0, -1).map(expression => babel.types.expressionStatement(expression)));
            init.replaceWith(value);
        }});
        coverage = visitor.exit(program).fileCoverage;
        coverageName = program.node.body.find(node => !snapshots.has(node) && node.type === 'FunctionDeclaration')?.id.name;
        program.stop();
    }});
    function templateCounter(node) {
        if (node?.type !== 'UpdateExpression' || node.operator !== '++') return;
        let member = node.argument, branch;
        if (member.object?.object?.property?.name === 'b') {
            branch = member.property.value;
            member = member.object;
        }
        const group = member.object?.property?.name;
        if (!['s', 'f', 'b'].includes(group) || member.object.object?.callee?.name !== coverageName) return;
        const id = `${scriptId}:${group}:${member.property.value}${branch === undefined ? '' : ':' + branch}`;
        return babel.parseSync(`(${hit(templateId, id)})`, {configFile: false, babelrc: false}).program.body[0].expression;
    }
    function replaceCounters(node) {
        const replacement = templateCounter(node);
        if (replacement) return replacement;
        for (const key of babel.types.VISITOR_KEYS[node.type] || []) {
            if (Array.isArray(node[key])) node[key] = node[key].map(replaceCounters);
            else if (node[key]) node[key] = replaceCounters(node[key]);
        }
        return node;
    }
    function render(node) {
        const old = snapshots.get(node);
        const trace = old && traced.get(old.start);
        if (trace && node.type === 'ExpressionStatement') return trace.replacement + source.slice(trace.end, old.end);
        if (!old) {
            // Use the template collector directly; never create an Istanbul global
            // or send template counters to the consuming application's JS report.
            if (node.type === 'FunctionDeclaration' && node.id.name === coverageName ||
                node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression' && node.expression.callee.name === coverageName) return '';
            switch (node.type) {
                case 'BlockStatement': return `{${node.body.map(render).join('')}}`;
                case 'ReturnStatement': return `return (${render(node.argument)});`;
                case 'SequenceExpression': return `(${node.expressions.map(render).join(',')})`;
                case 'ParenthesizedExpression': return `(${render(node.expression)})`;
                default:
                    // All remaining generated nodes contain counters only. Do
                    // not silently regenerate any original child if Istanbul
                    // adds a new transformation in a future version.
                    babel.types.traverseFast(node, child => { if (snapshots.has(child)) throw new Error(`Unsupported Istanbul edit: ${node.type}`); });
                    return generate(replaceCounters(babel.types.cloneNode(node, true)), {compact: true, comments: false}).code.replace(/<\/script/gi, '<\\/script');
            }
        }
        const edits = [];
        for (const [key, previous] of Object.entries(old.children)) {
            const current = node[key];
            if (Array.isArray(previous)) {
                if (previous.some(child => !current.includes(child))) throw new Error(`Unsupported Istanbul list edit: ${node.type}.${key}`);
                for (const child of previous) {
                    const text = render(child);
                    if (text !== source.slice(child.start, child.end)) edits.push({start: child.start, end: child.end, text});
                }
                for (let index = 0; index < current.length; index++) {
                    const child = current[index];
                    if (previous.includes(child)) continue;
                    const next = current.slice(index + 1).find(entry => previous.includes(entry));
                    let offset = next?.start ?? previous.at(-1)?.end;
                    const counterKind = child.expression?.argument?.object?.property?.name;
                    if (node.type === 'Program' && index < 2) {
                        offset = node.directives.at(-1)?.end ?? start;
                    } else if (node.type === 'BlockStatement' && (offset === undefined || ['f', 'b'].includes(counterKind))) offset = node.directives.at(-1)?.end ?? old.start + 1;
                    else if (offset === undefined && node.type === 'SwitchCase') {
                        const afterTest = node.test?.end ?? old.start + 'default'.length;
                        offset = source.indexOf(':', afterTest) + 1;
                    }
                    if (offset === undefined) throw new Error(`Unsupported empty Istanbul list: ${node.type}.${key}`);
                    edits.push({start: offset, end: offset, text: ';' + render(child)});
                }
            } else if (previous) {
                const text = render(current);
                if (text !== source.slice(previous.start, previous.end)) edits.push({start: previous.start, end: previous.end, text});
            } else if (current) {
                if (node.type !== 'IfStatement' || key !== 'alternate') throw new Error(`Unsupported Istanbul property: ${node.type}.${key}`);
                edits.push({start: old.end, end: old.end, text: 'else ' + render(current)});
            }
        }
        edits.sort((a, b) => a.start - b.start || a.end - b.end);
        let result = '', cursor = old.start;
        for (const edit of edits) {
            if (edit.start < cursor || edit.end > old.end) throw new Error('Overlapping Istanbul edits');
            result += source.slice(cursor, edit.start) + edit.text;
            cursor = edit.end;
        }
        return result + source.slice(cursor, old.end);
    }
    const instrumented = render(ast.program);
    if (instrumented.replace(/[^\r\n]/g, '') !== source.slice(start, end).replace(/[^\r\n]/g, '')) throw new Error('Instrumentation changed PHP line positions');
    parseScript(instrumented, phpIslands(instrumented), 0, instrumented.length, parserOptions);
    return {code: instrumented, coverage, generated};
}

function instrumentInline(source, templateId, {phtml = false} = {}) {
    const islands = phtml ? phpIslands(source) : [];
    let masked = source;
    for (const island of [...islands].reverse()) masked = masked.slice(0, island.start) + island.text.replace(/[^\r\n]/g, ' ') + masked.slice(island.end);
    const edits = [], scripts = [], baseline = {}, replacements = [];
    const statements = [], functions = [], branches = [];
    const location = offset => {
        const lines = source.slice(0, offset).split(/\r\n|\r|\n/);
        return {line: lines.length, column: lines.at(-1).length};
    };
    function region(from, to) {
        const tree = parseFragment(masked.slice(from, to), {sourceCodeLocationInfo: true});
        function visit(node) {
            const span = node.sourceCodeLocation;
            if (node.tagName === 'script' && span?.endTag) {
                const start = from + span.startTag.endOffset, end = from + span.endTag.startOffset;
                const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]));
                const type = (attrs.type || '').trim().toLowerCase();
                if (['text/html', 'text/x-magento-template', 'text/x-jquery-tmpl', 'text/x-template'].includes(type)) {
                    region(start, end);
                } else if (!('src' in attrs) && ['', 'module', 'text/javascript', 'application/javascript'].includes(type) && source.slice(start, end).trim()) {
                    const id = `script:${scripts.length + 1}`;
                    const record = {id, line: location(start).line};
                    try {
                        const result = instrumentScript(source, islands, start, end, `${templateId}/${id}`, type === 'module', templateId, id);
                        edits.push({start, end, text: result.code});
                        replacements.push({original: source.slice(from + span.startOffset, from + span.endOffset),
                            instrumented: source.slice(from + span.startOffset, start) + result.code + source.slice(end, from + span.endOffset)});
                        baseline[id] = result.coverage;
                        for (const [key, loc] of Object.entries(result.coverage.statementMap)) statements.push({id: `${id}:s:${key}`, binding: 'script statement', syntax: 'inline-script', ...loc});
                        for (const [key, fn] of Object.entries(result.coverage.fnMap)) functions.push({id: `${id}:f:${key}`, name: fn.name, ...fn.loc});
                        for (const [key, branch] of Object.entries(result.coverage.branchMap)) branch.locations.forEach((loc, index) => branches.push({id: `${id}:b:${key}:${index}`, type: branch.type, ...(Number.isInteger(loc.start?.line) ? loc : {...branch.loc, implicit: true})}));
                        scripts.push({...record, status: 'instrumented', generated: result.generated});
                    } catch (error) {
                        scripts.push({...record, status: 'unsupported', reason: error.message.split('\n')[0]});
                    }
                }
            }
            for (const child of node.childNodes || []) visit(child);
            // A script in a native template is measured only when the application
            // inserts/executes it. Merely parsing or caching it produces no hit.
            if (node.content) visit(node.content);
        }
        visit(tree);
    }
    region(0, source.length);
    let output = source;
    for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
    return {code: output, baseline, scripts, replacements, statements, functions, branches};
}

module.exports = {instrumentInline, phpIslands};
