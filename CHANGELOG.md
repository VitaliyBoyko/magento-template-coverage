# Changelog

## 1.5.0 - 2026-10-18

- Support Hyvä CSP Alpine bindings without dynamic code generation, preserving event arguments, model writes, loop locals and inserted templates.
- Collect DOM observations under strict CSP without requiring `unsafe-eval`, while retaining Magento Admin’s Prototype DOM extensions.
- Measure PHP-selected lexical declarations in inline scripts, including the Hyvä CSP date-option template.
- Provide `installTemplateRuntime` for Playwright warm-up contexts that serve instrumented templates without recording coverage.
- Recreate manifests, instrumented copies and raw records when upgrading: version 1.5 uses new template identities.


## 1.4.0

- Link PHP-rendered JavaScript fragments to instrumented child templates in HTML and JSON reports.
- Distinguish empty output, linked child sources, unresolved generated code and output not observed during the run.
- Preserve execution counts at the child source; rendering a fragment does not cover its functions or branches.
- Collect source references through Cypress and Playwright across navigation, without adding template entries to JavaScript coverage.

Recreate manifests, disposable copies, static assets and raw records when upgrading. Version 1.4 changes template identities; JSON remains schema 2.

## 1.3.0

- Include inline classic/module scripts in HTML/PHTML template coverage, with statement, function and branch counters mapped to the original template.
- Collect script execution through the existing Cypress and Playwright adapters, including inserted fragments and consumed native templates, without adding template entries to JavaScript coverage.
- Include static PHTML browser markup in DOM coverage and detect Knockout, legacy engines and Alpine bindings in PHTML.
- Preserve PHP code and line positions; show unsupported scripts and PHP-generated fragments as explicit coverage gaps.
- Keep inline scripts and JavaScript template literals in Alpine attributes from affecting template-engine detection and retain zero counters for unused templates and handlers.

Recreate manifests, disposable copies, static assets and raw records when upgrading. Version 1.3 changes template identities and adds script/function/branch details to schema 2 reports.

## 1.2.0

- Added a Playwright context collector and composable fixtures, including TypeScript declarations and elgentos fixture examples.
- Added Alpine directive execution coverage in HTML and Hyvä PHTML while preserving PHP code/source lines and source-copy isolation.
- Preserved mixed Knockout/Alpine HTML, two-way model updates, radio groups, unexecuted branches, and existing Cypress engine integration.
- Fixed collection for global Knockout builds that populate their exports after publishing the object.
- Added real Playwright navigation/frame/page-close and Alpine/Knockout regressions. Unsupported directive forms are reported explicitly.

## 1.1.2

- Run DOM observation and traversal in the application window's JavaScript realm, preserving Prototype DOM extensions on Magento admin pages during Cypress coverage.
- Verify legacy Magento fieldset interaction and template markers alongside the existing rendering and execution coverage regressions.

## 1.1.1

- Let instrumented Underscore and Magento literal templates render safely while the execution collector is unavailable.
- Restore a deleted execution helper when Cypress reconnects to a retained document.

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
