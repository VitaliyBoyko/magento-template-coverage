# Changelog

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
