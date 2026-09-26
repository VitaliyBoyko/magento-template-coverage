'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const metric = value => `${value.covered}/${value.total} (${value.percent === null ? 'N/A' : `${value.percent.toFixed(2)}%`})`;
const semantics = 'Executable lines are starting source lines of measured template expressions: Knockout binding value accessors, Underscore expressions/evaluation code, jQuery directives and Magento template literals. A binding hit does not prove its event handler ran or its condition was true. Static markup and continuation lines have no execution denominator. DOM presence is measured separately.';
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><style>
body{font:15px system-ui;margin:24px;color:#17202a}table{border-collapse:collapse;width:100%}td,th{padding:9px;border:1px solid #dfe3e6;text-align:left}th{background:#f6f8fa}a{color:#075e67;text-underline-offset:2px}a:focus-visible{outline:3px solid #075e67}td:first-child{overflow-wrap:anywhere}.covered,.observed,.high{background:#e0f1d7}.uncovered,.unobserved,.low{background:#f8dddd}.partial,.medium{background:#fff5cd}.unsupported,.neutral{color:#59636c}input{padding:8px;min-width:260px}p{max-width:1200px;line-height:1.6}.source{font:13px ui-monospace,monospace}.source td{padding:3px 10px}.source .code{white-space:pre;min-width:600px}.source .number{width:55px}.source .hits{width:80px;text-align:right}.scroll{overflow-x:auto}h1{overflow-wrap:anywhere;font-size:26px}nav{padding:14px;background:#edf0f3;border-radius:5px;line-height:1.7;overflow-wrap:anywhere}.metric{min-width:175px;font-variant-numeric:tabular-nums}.bar{display:inline-block;width:75px;height:12px;background:#e9ecef;border-radius:3px;margin-right:10px;overflow:hidden}.bar span{display:block;height:100%;background:#29a34a}.low .bar span{background:#dc3545}.medium .bar span{background:#ffc107}.total{font-weight:600}.legend{margin-top:28px;border-top:1px solid #ddd;padding-top:18px}.legend span{padding:3px 6px}.muted{font-size:13px;color:#59636c}tfoot{font-weight:600}
</style></head><body>${body}</body></html>\n`;

const aggregate = (entries, key) => {
    const total = entries.reduce((sum, entry) => sum + entry[key].total, 0);
    const covered = entries.reduce((sum, entry) => sum + entry[key].covered, 0);
    return { total, covered, uncovered: total - covered, percent: total ? Math.round(covered / total * 10000) / 100 : null };
};
const totals = entries => {
    const eligible = entries.filter(entry => entry.instrumented);
    const covered = eligible.filter(entry => entry.status === 'observed').length;
    return {
        lines: aggregate(entries, 'lineSummary'), statements: aggregate(entries, 'statementSummary'),
        dom: { total: eligible.length, covered, percent: eligible.length ? Math.round(covered / eligible.length * 10000) / 100 : null },
        unsupported: entries.length - eligible.length
    };
};
const directoryFile = directory => directory ? `directories/${createHash('sha256').update(directory).digest('hex').slice(0, 32)}.html` : 'index.html';
const href = (from, to) => path.posix.relative(path.posix.dirname(from), to).split('/').map(encodeURIComponent).join('/');
const cell = value => {
    const level = value.percent === null ? 'neutral' : value.percent < 50 ? 'low' : value.percent < 90 ? 'medium' : 'high';
    return `<td class="metric ${level}"><span class="bar" aria-hidden="true"><span style="width:${value.percent || 0}%"></span></span>${metric(value)}</td>`;
};
const legend = '<p class="legend"><strong>Legend</strong> · <span class="low">Low: below 50%</span> <span class="medium">Medium: 50–90%</span> <span class="high">High: 90–100%</span> · N/A: no measured statements</p>';

function writeReport(report, output) {
    fs.mkdirSync(path.join(output, 'files'), { recursive: true });
    fs.mkdirSync(path.join(output, 'directories'), { recursive: true });
    const directories = new Map([['', []]]);
    for (const entry of report.templates) {
        const parts = entry.path.split('/');
        for (let index = 0; index < parts.length; index++) {
            const directory = parts.slice(0, index).join('/');
            if (!directories.has(directory)) directories.set(directory, []);
            directories.get(directory).push(entry);
        }
    }
    const breadcrumbs = (file, directory, basename) => {
        let cumulative = '';
        const links = [`<a href="${href(file, 'index.html')}">All templates</a>`];
        for (const part of directory.split('/').filter(Boolean)) {
            cumulative += (cumulative ? '/' : '') + part;
            links.push(`<a href="${href(file, directoryFile(cumulative))}">${escape(part)}</a>`);
        }
        if (basename) links.push(escape(basename));
        return `<nav aria-label="Breadcrumb">${links.join(' / ')}</nav>`;
    };
    const heading = values => `<p><strong>Executable lines: ${metric(values.lines)} · Statements: ${metric(values.statements)}</strong><br>Template DOM presence: ${metric(values.dom)}; ${values.unsupported} unsupported files; ${report.records} test records.</p>`;
    const fileRow = (entry, file, fullPath = false) => `<tr><td>${entry.instrumented ? `<a href="${href(file, `files/${entry.id}.html`)}">${escape(fullPath ? entry.path : path.posix.basename(entry.path))}</a>` : escape(fullPath ? entry.path : path.posix.basename(entry.path))}<br><span class="muted">${escape(entry.engines?.join(', ') || entry.kind)} · ${entry.status}</span>${entry.executionUnsupported ? `<br>${escape(entry.executionUnsupported)}` : ''}</td>${cell(entry.lineSummary)}${cell(entry.statementSummary)}${cell({total: entry.instrumented ? 1 : 0, covered: entry.status === 'observed' ? 1 : 0, percent: !entry.instrumented ? null : entry.status === 'observed' ? 100 : 0})}</tr>`;
    const table = (rows, values) => `<div class="scroll"><table><thead><tr><th>Directory / file</th><th>Executable lines</th><th>Statements</th><th>Template DOM presence</th></tr></thead><tbody><tr class="total"><td>Total</td>${cell(values.lines)}${cell(values.statements)}${cell(values.dom)}</tr>${rows}</tbody></table></div>`;
    const baseline = report.records ? '' : '<p><strong>No browser observations collected. This is an inventory baseline, not a completed coverage run.</strong></p>';
    const summaries = [];
    for (const [directory, entries] of [...directories].sort(([a], [b]) => a.localeCompare(b))) {
        const file = directoryFile(directory), values = totals(entries);
        const children = [...directories.keys()].filter(name => name && path.posix.dirname(name) === (directory || '.')).sort();
        const rows = children.map(child => {
            const summary = totals(directories.get(child));
            return `<tr><td>📁 <a href="${href(file, directoryFile(child))}">${escape(path.posix.basename(child))}</a></td>${cell(summary.lines)}${cell(summary.statements)}${cell(summary.dom)}</tr>`;
        }).concat(entries.filter(entry => path.posix.dirname(entry.path) === (directory || '.')).sort((a, b) => a.path.localeCompare(b.path)).map(entry => fileRow(entry, file))).join('\n');
        fs.writeFileSync(path.join(output, file), page(directory || 'Magento template coverage', `${breadcrumbs(file, directory)}
<h1>${escape(directory || 'Magento template coverage')}</h1>${heading(values)}${baseline}
${table(rows, values)}<p><a href="${href(file, 'all.html')}">Search all files</a></p>${legend}<p>${semantics}</p>
<p class="muted">Inventory roots: ${escape(report.roots.join(', '))}. Physical files are counted independently; module/theme applicability is not resolved.</p>`));
        summaries.push({ path: directory, report: file, ...values });
    }
    for (const entry of report.templates.filter(entry => entry.instrumented)) {
        const file = `files/${entry.id}.html`;
        const sourceRows = entry.source.split(/\r\n|\r|\n/).map((text, index) => {
            const number = index + 1, line = entry.lineHits[number];
            const state = !line ? 'neutral' : !line.hits ? 'uncovered' : line.covered < line.statements ? 'partial' : 'covered';
            return `<tr id="L${number}" class="${state}"><td class="number"><a href="#L${number}">${number}</a></td><td class="hits">${line ? `${line.hits}×` : ''}</td><td class="code">${escape(text)}</td></tr>`;
        }).join('\n');
        const statements = [...entry.statements].sort((a, b) => a.start.line - b.start.line || a.start.column - b.start.column).map(statement => `<tr class="${statement.hits ? 'covered' : 'uncovered'}"><td><a href="#L${statement.start.line}">${statement.start.line}:${statement.start.column + 1}</a></td><td>${escape(statement.binding)}</td><td>${escape(statement.syntax)}</td><td>${statement.hits}</td></tr>`).join('\n');
        fs.writeFileSync(path.join(output, file), page(entry.path, `${breadcrumbs(file, path.posix.dirname(entry.path), path.posix.basename(entry.path))}<h1>${escape(entry.path)}</h1>
${heading(totals([entry]))}${entry.executionUnsupported ? `<p>${escape(entry.executionUnsupported)}</p>` : ''}<p>Engines: ${escape(entry.engines?.join(', ') || 'knockout')} · DOM: ${entry.status}; ${entry.observations} test observations.</p>
<p>${semantics}</p><p>Green: executed. Red: never executed. Amber: some statements on this line did not execute. Grey: no measured statement.</p>
<div class="scroll"><table class="source"><thead><tr><th>Line</th><th>Hits</th><th>Original source</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
<h2>Template statements</h2><table><thead><tr><th>Line:column</th><th>Expression / directive</th><th>Syntax</th><th>Executions</th></tr></thead><tbody>${statements}</tbody></table>`));
    }
    fs.writeFileSync(path.join(output, 'all.html'), page('All template files', `${breadcrumbs('all.html', '')}<h1>All template files</h1>${baseline}
<p><label>Filter templates <input id="filter" type="search" placeholder="Path, engine or status"></label></p>${table(report.templates.map(entry => fileRow(entry, 'all.html', true)).join('\n'), totals(report.templates))}
<script>document.getElementById('filter').addEventListener('input',function(){var query=this.value.toLowerCase();document.querySelectorAll('tbody tr:not(.total)').forEach(function(row){row.hidden=!row.textContent.toLowerCase().includes(query);});});</script>`));
    fs.writeFileSync(path.join(output, 'coverage-summary.json'), `${JSON.stringify({ ...report, directories: summaries }, null, 2)}\n`);
}

module.exports = { writeReport };
