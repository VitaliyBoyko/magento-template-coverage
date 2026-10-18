'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { analyzeTemplate } = require('./template');
const { writeReport } = require('./report');
const { engines: supportedEngines } = require('./engines');

const hash = value => createHash('sha256').update(value).digest('hex');
const portable = value => value.split(path.sep).join('/');

function inside(parent, child) {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonical(file) {
    if (fs.existsSync(file)) return fs.realpathSync(file);
    const parent = path.dirname(file);
    if (parent === file) throw new Error(`Cannot resolve path: ${file}`);
    return path.join(canonical(parent), path.basename(file));
}

function walk(directory, visit) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(directory, entry.name);
        // Never silently omit symlinked template trees from the denominator.
        if (entry.isSymbolicLink()) throw new Error(`Symlinks are unsupported in coverage inputs: ${file}`);
        if (entry.isDirectory()) walk(file, visit);
        else if (entry.isFile()) visit(file);
    }
}

function createManifest({ source, roots = ['app/code', 'app/design'], engines = {} }) {
    source = fs.realpathSync(source);
    const templates = new Map();
    const overrides = Object.entries(engines).sort((a, b) => b[0].length - a[0].length);
    for (const [name, engine] of overrides) {
        if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || !supportedEngines.includes(engine)) {
            throw new Error(`Invalid template engine override: ${name}=${engine}`);
        }
    }
    const matched = new Set();
    for (const root of roots) {
        const directory = path.resolve(source, root);
        if (path.isAbsolute(root) || !inside(source, directory) || directory === source ||
            fs.realpathSync(directory) !== directory) {
            throw new Error(`Inventory root must be a real directory beneath the Magento source: ${root}`);
        }
        walk(directory, file => {
            if (!/\.(html|phtml)$/.test(file)) return;
            const phtml = file.endsWith('.phtml');
            const relative = portable(path.relative(source, file));
            const content = fs.readFileSync(file, 'utf8');
            if (/<!--mtc:[a-f0-9]{32}-->|\/\*mtc_|__mtcTemplateHit/.test(content)) throw new Error(`Source is already instrumented: ${relative}`);
            const kind = phtml ? 'browser-phtml' : 'browser-html';
            const override = overrides.find(([name]) => relative === name || relative.startsWith(`${name}/`));
            if (override) matched.add(override[0]);
            const serverOnly = /\{\{(?:var|trans|depend|layout|block|store|view|media|config|template)\s/.test(content);
            const engine = override?.[1] || (relative.includes('/email/') || serverOnly ? 'html' : 'auto');
            const id = hash(`1.5\0${engine}\0${relative}\0${content}`).slice(0, 32);
            let analysis;
            try { analysis = analyzeTemplate(content, id, engine, {phtml}); }
            catch (error) { throw new Error(`${relative}: ${error.message}`); }
            // A PHP-only source has no browser markup to observe or execute.
            if (phtml && !/<[a-zA-Z]/.test(require('./alpine').maskPhp(content).masked)) return;
            templates.set(relative, {
                id,
                path: relative,
                digest: hash(content),
                kind,
                area: relative.match(/\/(frontend|adminhtml|base)\//)?.[1] || 'unknown',
                instrumented: true,
                source: content,
                unsupportedDirectives: analysis.unsupported,
                statements: analysis.statements,
                functions: analysis.functions,
                branches: analysis.branches,
                scripts: analysis.scripts,
                engine,
                engines: analysis.engines,
                executionUnsupported: analysis.executionUnsupported || (engine === 'html' && (relative.includes('/email/') || serverOnly)
                    ? 'Server-side HTML directives; DOM presence only if the resulting HTML is inserted into the tested document' : undefined)
            });
        });
    }
    for (const [name] of overrides) if (!matched.has(name)) throw new Error(`Engine override matched no inventoried template: ${name}`);
    return {
        schemaVersion: 2,
        metric: 'template-execution',
        roots: roots.map(root => portable(path.normalize(root))),
        templates: [...templates.values()].sort((a, b) => a.path.localeCompare(b.path))
    };
}

function validateManifest(manifest) {
    if (manifest.schemaVersion !== 2 || !['template-execution', 'template-binding-execution'].includes(manifest.metric) || !Array.isArray(manifest.templates)) {
        throw new Error('Unsupported template coverage manifest');
    }
    const ids = new Set();
    const paths = new Set();
    for (const entry of manifest.templates) {
        if (!/^[a-f0-9]{32}$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.digest) ||
            typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.includes('\\') ||
            entry.path.split('/').some(part => part === '..' || part === '.' || part === '') ||
            ids.has(entry.id) || paths.has(entry.path) || typeof entry.instrumented !== 'boolean' || !Array.isArray(entry.statements)) {
            throw new Error('Invalid or duplicate template manifest entry');
        }
        if (entry.instrumented) {
            if (typeof entry.source !== 'string' || hash(entry.source) !== entry.digest) throw new Error('Invalid template source or statement map');
            const analysis = analyzeTemplate(entry.source, entry.id, entry.engine, {phtml: entry.kind === 'browser-phtml'});
            if (['statements', 'functions', 'branches', 'scripts'].some(key => JSON.stringify(analysis[key]) !== JSON.stringify(entry[key]))) throw new Error('Invalid template source or statement map');
        }
        ids.add(entry.id);
        paths.add(entry.path);
    }
}

function instrument({ source, manifest, mappings }) {
    validateManifest(manifest);
    source = fs.realpathSync(source);
    const targets = Object.entries(mappings).map(([root, target]) => {
        root = portable(path.normalize(root));
        target = path.resolve(target);
        if (canonical(target) !== target) throw new Error(`Refusing a symlinked destination: ${target}`);
        if (!manifest.roots.includes(root)) throw new Error(`Unknown inventory root: ${root}`);
        if (inside(source, target) || inside(target, source)) {
            throw new Error(`Refusing to instrument the original source tree: ${target}`);
        }
        return { root, target };
    }).sort((a, b) => b.root.length - a.root.length);

    for (let index = 0; index < targets.length; index++) {
        for (const other of targets.slice(index + 1)) {
            if (inside(targets[index].target, other.target) || inside(other.target, targets[index].target)) {
                throw new Error('Disposable template destinations must not overlap');
            }
        }
    }

    // Preflight every destination and source hash before modifying anything.
    const writes = manifest.templates.filter(entry => entry.instrumented).map(entry => {
        const mapping = targets.find(item => entry.path.startsWith(`${item.root}/`));
        if (!mapping) throw new Error(`No disposable destination for ${entry.path}`);
        const original = path.join(source, entry.path);
        if (!inside(source, canonical(original))) throw new Error(`Source escaped inventory: ${entry.path}`);
        const content = fs.readFileSync(original, 'utf8');
        if (hash(content) !== entry.digest) throw new Error(`Source changed since inventory: ${entry.path}`);
        const destination = path.join(mapping.target, entry.path.slice(mapping.root.length + 1));
        if (canonical(destination) !== destination || !inside(mapping.target, destination)) {
            throw new Error(`Refusing a symlinked destination: ${destination}`);
        }
        const analyzed = analyzeTemplate(content, entry.id, entry.engine, {phtml: entry.kind === 'browser-phtml'});
        let output = `<!--mtc:${entry.id}-->\n${analyzed.content}`;
        if (entry.kind === 'browser-phtml') {
            // Preserve declare(strict_types=1) and PHP source line numbers.
            const {masked} = require('./alpine').maskPhp(analyzed.content);
            const firstTag = masked.search(/<[a-zA-Z]/);
            if (firstTag < 0) throw new Error(`No HTML marker location: ${entry.path}`);
            output = analyzed.content.slice(0, firstTag) + `<!--mtc:${entry.id}-->` + analyzed.content.slice(firstTag);
        }
        return { destination, content: output, mode: fs.statSync(original).mode };
    });

    for (const { destination, content, mode } of writes) {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        // Rename rather than overwrite: a hardlink must never change the original.
        const temporary = `${destination}.${randomUUID()}.tmp`;
        fs.writeFileSync(temporary, content, { flag: 'wx', mode });
        fs.renameSync(temporary, destination);
    }
    return writes.length;
}

function merge(manifest, records) {
    validateManifest(manifest);
    const entries = new Map(manifest.templates.map(entry => [entry.id, entry]));
    const observations = new Map();
    const hits = new Map();
    const references = new Map();
    const recordIds = new Map();
    for (const record of records) {
        if (record.schemaVersion !== 2 || typeof record.recordId !== 'string' || !Array.isArray(record.ids) ||
            !record.hits || typeof record.hits !== 'object' || Array.isArray(record.hits)) {
            throw new Error('Invalid template hit record');
        }
        if (recordIds.has(record.recordId)) {
            if (recordIds.get(record.recordId) !== JSON.stringify(record)) throw new Error('Conflicting template hit records');
            continue;
        }
        recordIds.set(record.recordId, JSON.stringify(record));
        if (record.references !== undefined && !Array.isArray(record.references)) throw new Error('Invalid template references');
        for (const reference of record.references || []) {
            const entry = entries.get(reference?.template);
            if (!entry?.scripts.some(script => script.generated?.some(fragment => fragment.id === reference.fragment && fragment.tracked)) ||
                typeof reference.empty !== 'boolean' || !Array.isArray(reference.targets) ||
                reference.targets.some(id => !entries.get(id)?.scripts.some(script => script.status === 'instrumented')) ||
                reference.empty && reference.targets.length) throw new Error('Invalid template reference (stale manifest?)');
            const key = `${reference.template}/${reference.fragment}`;
            const state = references.get(key) || {targets: new Set(), empty: false, unresolved: false};
            for (const id of reference.targets) state.targets.add(id);
            state.empty ||= reference.empty;
            state.unresolved ||= !reference.empty && !reference.targets.length;
            references.set(key, state);
        }
        for (const id of new Set(record.ids)) {
            if (!entries.get(id)?.instrumented) throw new Error(`Unknown or unsupported template hit (stale manifest?): ${id}`);
            observations.set(id, (observations.get(id) || 0) + 1);
        }
        for (const [id, counters] of Object.entries(record.hits)) {
            const entry = entries.get(id);
            if (!entry?.instrumented || !counters || typeof counters !== 'object' || Array.isArray(counters)) {
                throw new Error(`Unknown or invalid statement hits (stale manifest?): ${id}`);
            }
            for (const [statement, count] of Object.entries(counters)) {
                if (![...entry.statements, ...entry.functions, ...entry.branches].some(item => item.id === statement) || !Number.isSafeInteger(count) || count < 1) {
                    throw new Error(`Invalid statement hit: ${id}/${statement}`);
                }
                const key = `${id}/${statement}`;
                const sum = (hits.get(key) || 0) + count;
                if (!Number.isSafeInteger(sum)) throw new Error('Statement hit count overflow');
                hits.set(key, sum);
            }
        }
    }
    const summary = values => {
        const total = values.length;
        const covered = values.filter(Boolean).length;
        return { total, covered, uncovered: total - covered, percent: total ? Math.round(10000 * covered / total) / 100 : null };
    };
    const templates = manifest.templates.map(entry => {
        const scripts = entry.scripts.map(script => ({...script, generated: script.generated?.map(fragment => {
            const reference = references.get(`${entry.id}/${fragment.id}`);
            const status = !reference ? 'unobserved' : reference.unresolved ? 'unresolved' : reference.targets.size ? 'linked' : 'empty';
            const targets = [...reference?.targets || []].map(id => ({id, path: entries.get(id).path})).sort((a, b) => a.path.localeCompare(b.path));
            const reason = status === 'linked' ? 'Rendered output references instrumented child templates; execution is counted at their original source locations.'
                : status === 'empty' ? 'PHP emitted no JavaScript in the observed renders; no execution counter is added.'
                : status === 'unresolved' ? 'Nonempty PHP-generated output was observed without an instrumented child-template source.' : fragment.reason;
            return {...fragment, status, targets, emptyObserved: reference?.empty || false, reason};
        })}));
        const statements = entry.statements.map(statement => ({ ...statement, hits: hits.get(`${entry.id}/${statement.id}`) || 0 }));
        const functions = entry.functions.map(item => ({...item, hits: hits.get(`${entry.id}/${item.id}`) || 0}));
        const branches = entry.branches.map(item => ({...item, hits: hits.get(`${entry.id}/${item.id}`) || 0}));
        const lineHits = {};
        for (const statement of statements) {
            const line = lineHits[statement.start.line] ||= { hits: 0, statements: 0, covered: 0 };
            line.hits += statement.hits;
            line.statements++;
            if (statement.hits) line.covered++;
        }
        return {
            ...entry, scripts, statements, functions, branches, lineHits,
            functionSummary: summary(functions.map(item => item.hits)),
            branchSummary: summary(branches.map(item => item.hits)),
            statementSummary: summary(statements.map(statement => statement.hits)),
            lineSummary: summary(Object.values(lineHits).map(line => line.hits)),
            observations: observations.get(entry.id) || 0,
            status: !entry.instrumented ? 'unsupported' : observations.has(entry.id) ? 'observed' : 'unobserved'
        };
    });
    const eligible = templates.filter(entry => entry.instrumented).length;
    const covered = templates.filter(entry => entry.status === 'observed').length;
    return {
        schemaVersion: 2,
        metric: manifest.metric,
        roots: manifest.roots,
        records: recordIds.size,
        summary: {
            eligible, covered, uncovered: eligible - covered,
            unsupported: templates.length - eligible,
            percent: eligible ? Math.round(10000 * covered / eligible) / 100 : null
        },
        statements: summary(templates.flatMap(entry => entry.statements.map(statement => statement.hits))),
        functions: summary(templates.flatMap(entry => entry.functions.map(item => item.hits))),
        branches: summary(templates.flatMap(entry => entry.branches.map(item => item.hits))),
        scripts: {instrumented: templates.flatMap(entry => entry.scripts).filter(script => script.status === 'instrumented').length,
            unsupported: templates.flatMap(entry => entry.scripts.filter(script => script.status === 'unsupported').map(script => ({path: entry.path, ...script}))),
            generated: templates.flatMap(entry => entry.scripts.flatMap(script => (script.generated || []).filter(fragment => ['unresolved', 'unobserved'].includes(fragment.status)).map(fragment => ({path: entry.path, ...fragment})))),
            references: templates.flatMap(entry => entry.scripts.flatMap(script => (script.generated || []).map(fragment => ({path: entry.path, ...fragment}))))},
        lines: summary(templates.flatMap(entry => Object.values(entry.lineHits).map(line => line.hits))),
        templates
    };
}

function readRecords(directory) {
    const records = [];
    if (fs.existsSync(directory)) walk(directory, file => {
        // Deliberately not .json: these are not Istanbul maps and may share a shard volume.
        if (file.endsWith('.mtc')) records.push(JSON.parse(fs.readFileSync(file, 'utf8')));
    });
    return records;
}

module.exports = { createManifest, instrument, merge, readRecords, writeReport };
