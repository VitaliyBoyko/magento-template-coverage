'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

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

function createManifest({ source, roots = ['app/code', 'app/design'] }) {
    source = fs.realpathSync(source);
    const templates = new Map();
    for (const root of roots) {
        const directory = path.resolve(source, root);
        if (path.isAbsolute(root) || !inside(source, directory) || directory === source ||
            fs.realpathSync(directory) !== directory) {
            throw new Error(`Inventory root must be a real directory beneath the Magento source: ${root}`);
        }
        walk(directory, file => {
            if (!/\.(html|phtml)$/.test(file)) return;
            const relative = portable(path.relative(source, file));
            const content = fs.readFileSync(file, 'utf8');
            if (/<!--mtc:[a-f0-9]{32}-->/.test(content)) throw new Error(`Source is already instrumented: ${relative}`);
            const kind = file.endsWith('.phtml') ? 'phtml'
                : relative.includes('/email/') ? 'email'
                    : /\/web\/templates?\//.test(relative) ? 'browser-html' : 'other-html';
            templates.set(relative, {
                id: hash(`${relative}\0${content}`).slice(0, 32),
                path: relative,
                digest: hash(content),
                kind,
                area: relative.match(/\/(frontend|adminhtml|base)\//)?.[1] || 'unknown',
                instrumented: kind === 'browser-html'
            });
        });
    }
    return {
        schemaVersion: 1,
        metric: 'template-dom-presence',
        roots: roots.map(root => portable(path.normalize(root))),
        templates: [...templates.values()].sort((a, b) => a.path.localeCompare(b.path))
    };
}

function validateManifest(manifest) {
    if (manifest.schemaVersion !== 1 || manifest.metric !== 'template-dom-presence' || !Array.isArray(manifest.templates)) {
        throw new Error('Unsupported template coverage manifest');
    }
    const ids = new Set();
    const paths = new Set();
    for (const entry of manifest.templates) {
        if (!/^[a-f0-9]{32}$/.test(entry.id) || !/^[a-f0-9]{64}$/.test(entry.digest) ||
            typeof entry.path !== 'string' || entry.path.startsWith('/') || entry.path.includes('\\') ||
            entry.path.split('/').some(part => part === '..' || part === '.' || part === '') ||
            ids.has(entry.id) || paths.has(entry.path) || typeof entry.instrumented !== 'boolean') {
            throw new Error('Invalid or duplicate template manifest entry');
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
        return { destination, content: `<!--mtc:${entry.id}-->\n${content}`, mode: fs.statSync(original).mode };
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
    const recordIds = new Map();
    for (const record of records) {
        if (record.schemaVersion !== 1 || typeof record.recordId !== 'string' || !Array.isArray(record.ids)) {
            throw new Error('Invalid template hit record');
        }
        if (recordIds.has(record.recordId)) {
            if (recordIds.get(record.recordId) !== JSON.stringify(record)) throw new Error('Conflicting template hit records');
            continue;
        }
        recordIds.set(record.recordId, JSON.stringify(record));
        for (const id of new Set(record.ids)) {
            if (!entries.get(id)?.instrumented) throw new Error(`Unknown or unsupported template hit (stale manifest?): ${id}`);
            observations.set(id, (observations.get(id) || 0) + 1);
        }
    }
    const templates = manifest.templates.map(entry => ({
        ...entry,
        observations: observations.get(entry.id) || 0,
        status: !entry.instrumented ? 'unsupported' : observations.has(entry.id) ? 'observed' : 'unobserved'
    }));
    const eligible = templates.filter(entry => entry.instrumented).length;
    const covered = templates.filter(entry => entry.status === 'observed').length;
    return {
        schemaVersion: 1,
        metric: manifest.metric,
        roots: manifest.roots,
        records: recordIds.size,
        summary: {
            eligible, covered, uncovered: eligible - covered,
            unsupported: templates.length - eligible,
            percent: eligible ? Math.round(10000 * covered / eligible) / 100 : null
        },
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

function writeReport(report, output) {
    const escape = value => String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
    const rows = report.templates.map(entry => `<tr class="${entry.status}"><td>${escape(entry.path)}</td><td>${escape(entry.area)}</td><td>${escape(entry.kind)}</td><td>${entry.status}</td><td>${entry.observations}</td></tr>`).join('\n');
    const { covered, eligible, unsupported, percent } = report.summary;
    const html = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Magento template coverage</title><style>
body{font:15px system-ui;margin:32px;color:#17202a}table{border-collapse:collapse;width:100%}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:left}td:first-child{overflow-wrap:anywhere}tr.observed{background:#eaf8eb}tr.unobserved{background:#fff2e5}tr.unsupported{color:#666}input{padding:8px;min-width:320px}p{max-width:1000px}
</style><h1>Browser template coverage</h1>
<p><strong>${covered} / ${eligible} templates observed (${percent === null ? 'N/A' : `${percent}%`})</strong>; ${unsupported} unsupported files; ${report.records} test records.</p>
${report.records ? '' : '<p><strong>No browser observations collected. This is an inventory baseline, not a completed coverage run.</strong></p>'}
<p>A hit means a source marker was observed in the document. It does not establish visibility, assertions, branch coverage, or correctness. Observations count test records, not render invocations.</p>
<p>Inventory roots: ${escape(report.roots.join(', '))}. All physical browser templates in these roots count, including inactive modules and overridden templates. Theme applicability and vendor fallback are not resolved. Email, PHP templates and other HTML are listed as unsupported; database content is not inventoried.</p>
<p><label>Filter templates <input id="filter" type="search" placeholder="Path, area, or status"></label></p>
<table><thead><tr><th>Source</th><th>Area</th><th>Type</th><th>Status</th><th>Test observations</th></tr></thead><tbody>${rows}</tbody></table>
<script>document.getElementById('filter').addEventListener('input',function(){var query=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(function(row){row.hidden=!row.textContent.toLowerCase().includes(query);});});</script></html>\n`;
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'coverage-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(output, 'index.html'), html);
}

module.exports = { createManifest, instrument, merge, readRecords, writeReport };
