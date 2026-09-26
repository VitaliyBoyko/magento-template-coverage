'use strict';

const fs = require('node:fs');
const path = require('node:path');
const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);
const metric = value => `${value.covered}/${value.total} (${value.percent === null ? 'N/A' : `${value.percent}%`})`;
const semantics = 'A statement hit records evaluation of a Knockout binding value accessor. Binding lines are the starting source lines of these declarations. Static markup, callback bodies, and other expression lines are not executable lines in this metric. Binding evaluation does not prove an event handler ran, a condition was true, or content was visible.';
const page = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><style>
body{font:15px system-ui;margin:32px;color:#17202a}table{border-collapse:collapse;width:100%}td,th{padding:9px;border-bottom:1px solid #ddd;text-align:left}th{text-align:left}a{color:#075e67}td:first-child{overflow-wrap:anywhere}.covered,.observed{background:#eaf8eb}.uncovered,.unobserved{background:#ffe9e9}.partial{background:#fff1cf}.unsupported,.neutral{color:#59636c}input{padding:8px;min-width:300px}p{max-width:1100px;line-height:1.6}.source{font:13px ui-monospace,monospace}.source td{padding:3px 10px}.source .code{white-space:pre;min-width:600px}.source .number{width:55px}.source .hits{width:80px;text-align:right}.scroll{overflow-x:auto}h1{overflow-wrap:anywhere}
</style></head><body>${body}</body></html>\n`;

function writeReport(report, output) {
    fs.mkdirSync(path.join(output, 'files'), { recursive: true });
    const rows = report.templates.map(entry => {
        const target = `files/${entry.id}.html`;
        if (entry.instrumented) {
            const sourceRows = entry.source.split(/\r\n|\r|\n/).map((text, index) => {
                const number = index + 1;
                const line = entry.lineHits[number];
                const state = !line ? 'neutral' : !line.hits ? 'uncovered' : line.covered < line.statements ? 'partial' : 'covered';
                return `<tr id="L${number}" class="${state}"><td class="number"><a href="#L${number}">${number}</a></td><td class="hits">${line ? `${line.hits}×` : ''}</td><td class="code">${escape(text)}</td></tr>`;
            }).join('\n');
            const statements = entry.statements.map(statement => `<tr class="${statement.hits ? 'covered' : 'uncovered'}"><td><a href="#L${statement.start.line}">${statement.start.line}:${statement.start.column + 1}</a></td><td>${escape(statement.binding)}</td><td>${escape(statement.syntax)}</td><td>${statement.hits}</td></tr>`).join('\n');
            fs.writeFileSync(path.join(output, target), page(entry.path, `<p><a href="../index.html">All templates</a></p><h1>${escape(entry.path)}</h1>
<p><strong>Binding lines: ${metric(entry.lineSummary)} · Statements: ${metric(entry.statementSummary)}</strong><br>DOM: ${entry.status}; ${entry.observations} test observations.</p>
${entry.executionUnsupported ? `<p>${escape(entry.executionUnsupported)}</p>` : ''}
<p>${semantics}</p><p>Green: evaluated. Red: never evaluated. Amber: some bindings on this line were not evaluated. Grey: no measured statement.</p>
<div class="scroll"><table class="source"><thead><tr><th>Line</th><th>Hits</th><th>Original source</th></tr></thead><tbody>${sourceRows}</tbody></table></div>
<h2>Binding statements</h2><table><thead><tr><th>Line:column</th><th>Binding</th><th>Syntax</th><th>Evaluations</th></tr></thead><tbody>${statements}</tbody></table>`));
        }
        return `<tr><td>${entry.instrumented ? `<a href="${target}">${escape(entry.path)}</a>` : escape(entry.path)}${entry.executionUnsupported ? `<br>${escape(entry.executionUnsupported)}` : ''}</td><td>${metric(entry.lineSummary)}</td><td>${metric(entry.statementSummary)}</td><td class="${entry.status}">${entry.status}</td><td>${entry.observations}</td></tr>`;
    }).join('\n');
    const { covered, eligible, unsupported, percent } = report.summary;
    fs.writeFileSync(path.join(output, 'index.html'), page('Magento template coverage', `<h1>Magento template execution coverage</h1>
<p><strong>Binding lines: ${metric(report.lines)} · Statements: ${metric(report.statements)}</strong><br>Template DOM coverage: ${covered}/${eligible} (${percent === null ? 'N/A' : `${percent}%`}); ${unsupported} unsupported files; ${report.records} test records.</p>
${report.records ? '' : '<p><strong>No browser observations collected. This is an inventory baseline, not a completed coverage run.</strong></p>'}
<p>${semantics}</p><p>DOM observations independently count test records whose source markers entered the document. Fetching or parsing a template alone does not count as execution.</p>
<p>Inventory roots: ${escape(report.roots.join(', '))}. All physical browser templates in these roots count. Active modules, theme applicability and vendor fallback are not resolved.</p>
<p><label>Filter templates <input id="filter" type="search" placeholder="Path or status"></label></p>
<div class="scroll"><table><thead><tr><th>Source</th><th>Binding lines</th><th>Statements</th><th>DOM status</th><th>Test observations</th></tr></thead><tbody>${rows}</tbody></table></div>
<script>document.getElementById('filter').addEventListener('input',function(){var query=this.value.toLowerCase();document.querySelectorAll('tbody tr').forEach(function(row){row.hidden=!row.textContent.toLowerCase().includes(query);});});</script>`));
    fs.writeFileSync(path.join(output, 'coverage-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = { writeReport };
