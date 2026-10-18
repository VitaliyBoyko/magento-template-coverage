# Magento template coverage

Coverage for Magento HTML/PHTML templates, including Knockout, jQuery templates, Hyvä/Alpine bindings and inline JavaScript. Supports Cypress and Playwright collection with Luma/Knockout and regular Hyvä/Alpine 3. Reports separate executable source lines from DOM presence. Originals stay untouched; only disposable copies are instrumented.

## Install

```sh
npm install --save-dev @vitaliiboiko/magento-template-coverage@1.3.0
```

Node.js 18.3+ and an existing Cypress or Playwright installation are required. Each test runner retains its own Node/browser requirements.

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

Alpine support targets the regular Alpine 3 evaluator used by the Hyvä default theme. The restricted Alpine CSP evaluator is not supported by expression instrumentation. PHTML is tokenized to leave PHP code and PHP line numbers unchanged; directives emitted wholly by PHP and dynamic attribute names are not assigned invented source locations. Unquoted/malformed directives and dynamic or multiline `x-model` expressions remain unchanged with a visible report limitation. Dynamic input type/name bindings are also left uninstrumented for model coverage. Custom Alpine plugins are measured only through the supported directives they evaluate.

## Inline scripts and inserted fragments

Executable scripts are instrumented in HTML/PHTML and native `<template>` bodies. The same counters work when an application inserts or executes an instrumented template fragment later. Fetching, parsing or caching a fragment alone does not count as execution. Scripts loaded through `src` belong to their separate `.js` file; JSON and `text/x-magento-init` blocks are data, not executable script bodies.

PHTML scripts support PHP values, identifier suffixes and PHP `if/else` initializer choices. PHP code, strings, comments and original newlines are preserved. PHP branch choices are not counted as JavaScript branches. Unsupported scripts remain unchanged and are listed in the report. JavaScript emitted entirely by PHP has no static browser source map; those fragments are listed separately and never counted as covered. Runtime-generated template strings, database content and arbitrary generated code are not assigned invented source locations.

The template report shows bindings and scripts in the same original file. Function and branch counters describe inline JavaScript; they do not imply branch-level coverage inside Knockout, Alpine or other template binding expressions. In the JSON report, `scripts.unsupported` and `scripts.generated` list coverage gaps by path and line.

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
Version 1.3 uses new source identities for every template. Recreate manifests, copies and raw records when upgrading. JSON retains schema version 2 and adds per-file script diagnostics, function and branch counters and their summaries. Hits from old
source identities are rejected. The metric is now named `template-execution`.

Each test writes a unique `.mtc` record. Counters reset between tests, including
retained documents; observations survive navigation. Reports recursively merge shard
records and deduplicate copied record IDs. Stale IDs, conflicting records and invalid
counts fail the report. No records produces an explicitly labelled inventory baseline.
Keep generated artifacts and this package in test infrastructure.

Cross-window collection runs its DOM observer in the application's JavaScript realm
so it preserves Prototype's DOM extensions. Initializing it from Cypress uses the
application's `Function` constructor and requires its CSP to permit dynamic code
evaluation, as Magento's legacy and template engines do.

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
