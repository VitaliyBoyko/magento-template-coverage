#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { createManifest, instrument, merge, readRecords, writeReport } = require('../lib');

function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            source: { type: 'string' },
            root: { type: 'string', multiple: true },
            map: { type: 'string', multiple: true },
            manifest: { type: 'string' },
            hits: { type: 'string' },
            output: { type: 'string' },
            help: { type: 'boolean' }
        }
    });
    if (values.help || !positionals.length) {
        console.log(`Magento template execution coverage
  inventory --source <Magento> --manifest <file> [--root app/code --root app/design]
  instrument --source <Magento> --manifest <file> --map app/code=<copy> --map app/design=<copy>
  report --manifest <file> --hits <shard-directory> --output <report-directory>

Instrumentation only writes outside the original Magento tree. Reports measure
Knockout binding statements, their starting source lines, and separate template DOM presence.`);
        return;
    }
    const command = positionals[0];
    const required = command === 'inventory' ? ['source', 'manifest']
        : command === 'instrument' ? ['source', 'manifest', 'map']
            : command === 'report' ? ['manifest', 'hits', 'output'] : null;
    if (!required || positionals.length !== 1) throw new Error(`Unknown command: ${positionals.join(' ')}`);
    for (const option of required) if (!values[option]) throw new Error(`Missing --${option}`);
    if (command === 'inventory') {
        const manifest = createManifest({ source: values.source, roots: values.root });
        fs.mkdirSync(path.dirname(values.manifest), { recursive: true });
        fs.writeFileSync(values.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
        console.log(`Inventoried ${manifest.templates.length} files; ${manifest.templates.filter(entry => entry.instrumented).length} browser templates.`);
    } else {
        const manifest = JSON.parse(fs.readFileSync(values.manifest, 'utf8'));
        if (command === 'instrument') {
            const mappings = {};
            for (const mapping of values.map) {
                const separator = mapping.indexOf('=');
                if (separator < 1 || separator === mapping.length - 1) throw new Error(`Invalid --map: ${mapping}`);
                const root = mapping.slice(0, separator);
                if (Object.hasOwn(mappings, root)) throw new Error(`Duplicate --map: ${root}`);
                mappings[root] = mapping.slice(separator + 1);
            }
            console.log(`Instrumented ${instrument({ source: values.source, manifest, mappings })} disposable templates.`);
        } else {
            const report = merge(manifest, readRecords(values.hits));
            writeReport(report, values.output);
            console.log(`Binding execution: ${report.lines.covered}/${report.lines.total} lines; ${report.statements.covered}/${report.statements.total} statements.`);
            console.log(`Template DOM coverage: ${report.summary.covered}/${report.summary.eligible}; ${report.summary.unsupported} unsupported. Report: ${path.join(values.output, 'index.html')}`);
        }
    }
}

try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
