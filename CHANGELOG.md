# Changelog

## 1.1.0

- Inventory all and only `.html` files under configured roots, independent of directory layout.
- Add directory reports with breadcrumbs, aggregated line/statement/DOM totals and an optional searchable file list.
- Measure Underscore/mage-template, legacy jQuery tmpl and Magento UI literal execution in HTML files.
- Support inert template bodies stored inside HTML files, bare/default Magento bindings and SVG markup.
- Keep malformed or server-only syntax visible with explicit DOM-only explanations; allow engine overrides.
- Verify real engine output, cached/nested renders, escaping, false branches, directory totals and offline links.

Recreate manifests, disposable copies and raw records. Source identities change; the JSON metric is now `template-execution` (schema 2).

## 1.0.0

- Measure actual Knockout binding value evaluations in addition to template DOM presence.
- Map `data-bind`, virtual KO comments, and Magento shorthand to original lines and columns.
- Add source HTML reports with execution counts and uncovered/partial binding lines.
- Preserve observable identity, property writers, expression evaluation, and normal Magento rendering.
- Reset execution counters across tests and reattach across navigation and retained documents.
- Use schema version 2 and reject stale manifests, unsupported statement IDs, and invalid counts.
- Verify source mapping and merging with unit tests, plus real Magento/Knockout browser regressions.

Binding lines count declaration start lines. Callback bodies and expression branches are outside this metric.

## 0.1.0

- Initial inventory, disposable instrumentation, Cypress DOM collection, and template presence reports.
