# Magento 2 template coverage for Cypress and Playwright

Coverage for Magento HTML/PHTML templates, including Knockout, jQuery templates, Hyvä/Alpine bindings and inline JavaScript. Supports Cypress and Playwright collection with Luma/Knockout, Hyvä CSP and regular Hyvä/Alpine 3. Reports separate executable source lines from DOM presence. Originals stay untouched; only disposable copies are instrumented.

Use this package to find untested storefront bindings and inline scripts in Magento modules and themes. For a Docker environment that combines template, PHP and whole-file JavaScript reports, see [MageLens](https://github.com/VitaliyBoyko/MageLens).

[Install](#install) · [Supported syntax](#html-template-syntax) · [Report semantics](#reading-the-numbers) · [FAQ](#faq)

## Install

```sh
npm install --save-dev @vitaliiboiko/magento-template-coverage@1.5.0
```

Node.js 18.3+ and an existing Cypress or Playwright installation are required. Each test runner retains its own Node/browser requirements.

For existing installations, follow the [upgrade instructions](#repeat-runs-and-upgrades) when updating the package.

## Inventory → instrument → collect → report

Inventory every `.html` file under the selected roots, regardless of directory name.
The defaults are `app/code` and `app/design`. PHTML with browser markup is also inventoried, including script-only and static templates. PHP-only files, `.htm`, and whole `.js` files are excluded. PHP executable lines in PHTML remain in PHP coverage; the browser content belongs to template coverage.

```sh
npx --no-install magento-template-coverage inventory \
  --source src --manifest coverage/template-manifest.json

npx --no-install magento-template-coverage instrument \
  --source src --manifest coverage/template-manifest.json \
  --map app/code=coverage/template-copy/app-code \
  --map app/design=coverage/template-copy/app-design
```

Serve those disposable copies using your test environment and refresh Magento's
static assets and caches. The CLI rejects source-tree writes, symlinks, overlapping
destinations and changed source hashes. Repeated instrumentation starts from originals.
Use repeated `--root` and matching `--map` arguments to select other source directories.

Register the Cypress adapter before visiting the application:

```js
const { registerTemplateCoverage } = require('@vitaliiboiko/magento-template-coverage/cypress');
registerTemplateCoverage({ outputDir: '.template-coverage' });
```

For Playwright, extend your existing test fixture before using its `page` or `context`:

```js
const {test: base, expect} = require('@playwright/test');
const {withTemplateCoverage} = require('@vitaliiboiko/magento-template-coverage/playwright');
const test = withTemplateCoverage(base, {outputDir: '.template-coverage'});
module.exports = {test, expect};
```

Coverage starts before application navigation, including navigation in other fixtures. Records preserve hits across documents, frames and explicitly closed pages. Every test/context has independent counters; fixture teardown writes records even after assertion failures. Parallel workers write unique files that the reporter can merge.

For standalone Playwright scripts, call `await registerTemplateCoverage(context, options)` from the `/playwright` export **before creating pages**, then `await collector.stop()` in `finally`, before closing the context. `collector.flush()` drains currently open pages. Abrupt browser/process termination cannot guarantee final records.

To integrate [elgentos/magento2-playwright](https://github.com/elgentos/magento2-playwright), extend both existing fixtures in its customization layer; keep its authentication, consent and setup configuration:

```ts
// tests/utils/fixtures.utils.ts
import {test as baseTest, guestTest as baseGuest} from '@base/utils/fixtures.utils';
import {withTemplateCoverage} from '@vitaliiboiko/magento-template-coverage/playwright';
export * from '@base/utils/fixtures.utils';
export const test = withTemplateCoverage(baseTest);
export const guestTest = withTemplateCoverage(baseGuest);
```

Instrument the Magento source served by your test environment first. Adding a fixture alone does not instrument a remote store. Do not edit elgentos's generated `base-tests` directory.

After either runner:

```sh
npx --no-install magento-template-coverage report \
  --manifest coverage/template-manifest.json \
  --hits .template-coverage --output coverage/templates
```

Open **`coverage/templates/index.html`**. Directories have aggregated totals and
breadcrumb navigation, like a PHP coverage report. Each file links to its original
source with green/red/partial lines and statement counts. `all.html` provides a
searchable flat list. Every page works offline. `coverage-summary.json` includes
file and directory totals; directory percentages use summed covered/total counts.

## HTML template syntax

| Syntax inside `.html` / `.phtml` | Execution measured |
| --- | --- |
| Knockout `data-bind` and virtual `ko` comments | Binding value accessor evaluations; two-way property writers are preserved. |
| Magento UI shorthand | Standard renderer attributes and nodes, including `if`, `each`, `render`, `translate`, `ko-value`, and bare/default bindings. |
| Underscore / `mage/template` | `<%= … %>`, `<%- … %>`, and expressions in `<% … %>` code: conditions, loops, assignments, initializers, returns, and nested function bodies. |
| Legacy jQuery tmpl | `${…}`, `{{= …}}`, `if`, `else`, `each`, `html`, `tmpl`, and `wrap`. The normal engine still handles escaping, function invocation and nested templates. |
| Magento UI literals | `${ $.expression }`, including nested JavaScript expressions. |
| Alpine 3 / Hyvä default theme | `x-data`, `x-text`, `x-html`, `x-html-safe`, `x-show`, `x-if`, `x-bind` / `:`, `x-on` / `@`, `x-init`, `x-for` collections and assignable `x-model` expressions. Event hits count handler evaluation; inert/false template bodies stay uncovered. |
| Inline `<script>` / `<script type="module">` | Statements, functions and branch alternatives, mapped to the original HTML/PHTML file. Scripts in cached templates remain uncovered until the application executes them. |
| Plain HTML | DOM presence; static markup has no executable-line denominator. |
| Template bodies in an HTML file | Supported `<script type="text/html">`, `text/x-magento-template`, `text/x-jquery-tmpl`, `text/x-template`, and native `<template>` bodies remain unexecuted until consumed. |

The adapter installs counters before application code runs. Knockout and jQuery
integration attaches through RequireJS; application tests do not need to require
engines themselves. The legacy jQuery plugin is **not installed into your application**
by this package. The browser harness tests its pinned upstream implementation.

Automatic detection recognizes Underscore and jQuery directives. `${ $.… }` selects
Magento literals; other `${…}` outside Alpine attributes selects jQuery tmpl. JavaScript template literals inside Alpine attributes and inline scripts do not select a legacy template engine. For ambiguous syntax, override
an exact file or directory prefix during inventory; the most specific prefix wins:

```sh
npx --no-install magento-template-coverage inventory \
  --source src --manifest coverage/template-manifest.json \
  --engine app/code/Example/Module/view/frontend/web/fragments=literal
```

Available engines: `auto`, `knockout`, `underscore`, `jquery-tmpl`, `literal`, `alpine`, `html`.
Choose `html` to disable binding/engine expression instrumentation; executable inline scripts are still measured. Unrecognized/malformed binding expressions in
automatic mode are retained with a visible binding-coverage limitation; inline script coverage and DOM observation remain available. Explicit legacy engine
selections fail on syntax errors; unsupported Alpine directives remain unchanged with a report note. Server-rendered email directives also retain DOM-only
coverage; sending an email does not produce browser coverage.

Automatic detection retains legacy engine precedence in mixed HTML; Alpine attributes in those regions remain unchanged with a report note. Use an explicit engine override when the remaining template syntax is ambiguous. PHTML uses the same engine detection, with PHP tokens masked during parsing. Mixed Knockout and Alpine bindings can share a file.

Alpine support includes the Hyvä CSP evaluator and regular Alpine 3. CSP binding coverage supports the property-path syntax used by Hyvä 1.5.3 (Alpine CSP 3.14.3), retaining evaluation scope, event arguments, loop locals and getter/setter models. Other CSP evaluator expression languages are not supported. Expressions still need to be valid for the evaluator used by your application; coverage does not make regular Alpine expressions CSP-compatible. PHTML is tokenized to leave PHP code and PHP line numbers unchanged; directives emitted wholly by PHP and dynamic attribute names are not assigned invented source locations. Unquoted/malformed directives and dynamic or multiline `x-model` expressions remain unchanged with a visible report limitation. Dynamic input type/name bindings are also left uninstrumented for model coverage. Custom Alpine plugins are measured only through the supported directives they evaluate.

## Inline scripts and inserted fragments

Executable scripts are instrumented in HTML/PHTML and native `<template>` bodies. The same counters work when an application inserts or executes an instrumented template fragment later. Fetching, parsing or caching a fragment alone does not count as execution. Scripts loaded through `src` belong to their separate `.js` file; JSON and `text/x-magento-init` blocks are data, not executable script bodies.

PHTML scripts support PHP values, identifier suffixes, PHP `if/else` initializer choices and PHP-selected `const`/`let` declarations that retain their shared JavaScript scope. Original newlines and source locations are preserved. PHP branch choices are not counted as JavaScript branches. Unsupported scripts remain unchanged and are listed in the report. Runtime-generated template strings, database content and arbitrary generated code are not assigned invented source locations.

Standalone PHP `echo` expressions inside scripts are traced in the disposable copy. Each expression is evaluated once in its original PHP scope. A comment records whether its output is empty or contains counters from instrumented child templates, such as Hyvä reCAPTCHA validation fragments. The report links to those child source files; their statements, functions and branches are counted there only when JavaScript executes. The parent does not receive duplicate counters.

Output without a known child source stays unresolved. An expression that was not observed stays marked as not observed; it is not assumed to emit code. Links describe the instrumented child sources found in the output, not a source map for additional dynamically generated code. Supported tracing requires one expression in an `echo` statement (`<?= ... ?>` or `<?php echo ...; ?>`); other PHP output forms retain a diagnostic. Comments removed by a minifier or sanitizer can prevent source attribution without affecting the child execution counters.

The template report shows bindings and scripts in the same original file. Function and branch counters describe inline JavaScript; they do not imply branch-level coverage inside Knockout, Alpine or other template binding expressions. In the JSON report, `scripts.unsupported` lists unsupported scripts, `scripts.generated` lists unresolved or unobserved PHP output, and `scripts.references` includes all PHP output locations with their status and child-source links. Rendering and source attribution are separate from execution coverage.

## Reading the numbers

**Executable lines** are distinct starting source lines of measured bindings, template expressions and inline script statements. **Statements** count those individual operations. **Script functions** and **script branches** are separate metrics for inline scripts. Static text and continuation lines have no execution denominator.
A Knockout `click` hit records binding evaluation, not callback invocation. An `if`
hit does not prove its condition was true; jQuery `else` counts branch entry. Dynamic
bindings generated by another expression are not assigned invented Knockout source locations.

**DOM presence** is independent: the source marker entered the tested document.
Hidden DOM counts; fetched files, detached caches and inert template bodies alone do
not count. Compiling a template without rendering it produces no execution hits.
Rendering a detached fragment can produce execution hits without DOM presence.

All physical `.html` files under the selected roots remain in the denominator,
including unused files, along with PHTML containing browser markup. Module/theme applicability is not inferred. PHP rendering, templates generated wholly by PHP/JS, database content, shadow roots and arbitrary third-party languages are outside the execution metric. Playwright collects child frames; the Cypress adapter retains its top-document behavior. Comments stripped
by minifiers/sanitizers can prevent DOM observation. Use Istanbul for whole `.js` files and PCOV for PHP executable lines. Inline script counters are stored only in template records; they never create `window.__coverage__` entries.

## Repeat runs and upgrades

Use fresh manifests, disposable copies, static assets and raw records for each run.
Version 1.5 uses new source identities for every template. Recreate manifests, copies and raw records when upgrading. JSON retains schema version 2 and adds per-file script diagnostics, function and branch counters and their summaries. Hits from old
source identities are rejected. The metric is now named `template-execution`.

Each test writes a unique `.mtc` record. Counters reset between tests, including
retained documents; observations survive navigation. Reports recursively merge shard
records and deduplicate copied record IDs. Stale IDs, conflicting records and invalid
counts fail the report. No records produces an explicitly labelled inventory baseline.
Keep generated artifacts and this package in test infrastructure.

Collection does not use dynamic `Function` construction. For Cypress CSP checks,
set `experimentalCspAllowList: ['default-src', 'script-src', 'script-src-elem']`
and `modifyObstructiveCode: false` in the Cypress configuration. Cypress adds its
own script nonce and removes some directives; use Playwright when you need to test
the unmodified policy. See [Cypress CSP behavior](https://docs.cypress.io/app/references/content-security-policy).

Instrumented Alpine property paths use the reserved `x-mtc` directive and require
the package runtime before Alpine starts. The collection adapters install it
automatically. `withTemplateCoverage` also keeps auxiliary `browser.newContext()`
contexts functional, including worker-scoped login fixtures, without recording
their setup activity. For a separate warm-up browser that must not record coverage:

```js
// Playwright: register before navigating any page in this context.
const {installTemplateRuntime} = require('@vitaliiboiko/magento-template-coverage/playwright');
await installTemplateRuntime(context);

// Cypress: add to the warm-up support file.
const {observeExecution} = require('@vitaliiboiko/magento-template-coverage/browser');
Cypress.on('window:before:load', win => observeExecution(win, () => {}));
```

Keep warm-up and measured runs in separate browser contexts.

## Package development

```sh
npm test # requires PHP CLI for PHTML behavior checks
npm run test:types
npx playwright install chromium
npm run test:playwright
npm run test:browser -- /path/to/magento /path/to/cypress/node_modules/cypress
npm pack --dry-run
```

The browser harness uses the supplied Magento checkout's real Knockout, renderer,
Underscore, `mage/template`, UI literal renderer and modal HTML. It fetches the legacy
jQuery engine at the revision and SHA-256 in `test/browser/engines-lock.json`, cached
in browser artifacts. It never modifies the Magento checkout. Tests assert exact
source IDs, real counters, false-body zeros, cached rerenders and unchanged rendering.

## FAQ

### Does this replace PHP or JavaScript coverage?

No. This package measures browser expressions and inline scripts in HTML/PHTML. Use [PCOV](https://github.com/VitaliyBoyko/pcov) for PHP executable lines and Istanbul for whole `.js` files. [MageLens](https://github.com/VitaliyBoyko/MageLens) integrates all three collectors.

### Why is a visible template still uncovered?

DOM presence and expression execution are separate metrics. Confirm the application serves the instrumented disposable copies, refresh static assets, and register the adapter before navigation. A static template can have DOM presence without executable lines. See [reading the numbers](#reading-the-numbers).

### Does it support Hyvä CSP themes?

Yes. Hyvä CSP bindings and inline scripts are measured without enabling `unsafe-eval` or `unsafe-inline`. Keep the theme’s script nonces or hash registration enabled. Coverage instruments the script before Magento computes its hash. See [supported syntax and limitations](#html-template-syntax).

### Can I collect coverage from an existing remote store?

Only if you control its test environment and serve instrumented copies there. Installing a Cypress or Playwright fixture alone does not instrument the store. Keep instrumentation in test infrastructure.

## Releases and support

See the [changelog](CHANGELOG.md) and [GitHub releases](https://github.com/VitaliyBoyko/magento-template-coverage/releases). Report reproducible problems in [issues](https://github.com/VitaliyBoyko/magento-template-coverage/issues), including the package version, runner, template syntax and a minimal example.

## Repository navigation for AI agents

See [AGENTS.md](AGENTS.md) for the architecture map, source entry points, validation commands and contribution constraints.
