# Magento template coverage

Knockout binding execution and browser-template DOM coverage for isolated Magento
test environments. Version **1.0.0** provides an npm CLI, source reports, and a Cypress adapter.
It instruments disposable template copies; production code, Composer dependencies,
and original templates do not need to change. No PHP helper is required.

## Install

Install in your Cypress project:

```sh
npm install --save-dev @vitaliiboiko/magento-template-coverage
```

The CLI requires Node.js 18.3 or newer. The adapter runs inside an existing Cypress
installation. Keep the package in test infrastructure and exclude its generated
artifacts from version control and production deployments.

Upgrading from 0.1.0: recreate the manifest, disposable copies, static assets, and
raw records. Version 1 uses **schema version 2**; older records and manifests are
rejected. The inventory → instrument → collect → report commands stay the same.

## What coverage means

The CLI inventories templates beneath selected Magento roots and instruments
browser HTML in `web/template/` and `web/templates/`. It measures three things:

| Metric | What contributes a hit |
| --- | --- |
| Binding statements | Knockout evaluates a binding value accessor, such as `text`, `if`, `foreach`, `value`, `scope`, or `template`. |
| Binding lines | A statement starting on this source line was evaluated. Multiple statements on one line share one line denominator. |
| Template DOM presence | A template's source marker enters the document. This is independent of binding execution. |

The report links to original source with line numbers, evaluation counts, and
green/red/partial line highlighting. A statement list gives the binding name,
syntax, source column, and count. Unloaded templates and bindings inside false
conditions remain in the inventory with zero counts. Lines containing static
markup or only continuation text are grey, not falsely counted as executable.

**Binding evaluation is the measured execution unit.** Evaluating a `click`
binding can register a handler without invoking its body. Evaluating `if: open`
does not imply `open` was true. Callback bodies, individual JavaScript expression
branches, successful binding completion, assertions, and visibility are not
measured by this metric. Use Istanbul for application JavaScript.

The package parses HTML and binding object literals with source offsets. It adds
comments inside binding expressions in disposable copies. At runtime it wraps
accessors after Knockout parses them, preserving generated two-way property
writers, observable identity, return values, and single evaluation of expressions.
RequireJS's `onResourceLoad` hook attaches before consumers receive Knockout;
existing hooks are chained. No test needs to call application RequireJS modules.

DOM observations survive navigation and merge across tests/shards. Hidden DOM
counts; fetched, detached, and inert templates do not count as DOM observations.
Actually applying Knockout bindings to a detached tree can still record binding
execution. Record IDs prevent double-counting copied artifacts; source hashes and
statement IDs reject stale data. Every new test resets execution counters,
including retained pages with `testIsolation: false`.

## Supported binding syntax

- Knockout `data-bind` attributes, including multiple and multiline bindings,
  object literals, regular expressions, quoted keys, and HTML entities.
- Virtual `<!-- ko if: expression -->` and other `ko` comment bindings.
- Magento nodes: `if`, `ifnot`, `each`, `with`, `text`, `scope`, `component`,
  `render`, `translate`, `repeat`, and `fastForEach`.
- Magento attributes: the standard renderer bindings, `if`, `ifnot`, `innerif`,
  `innerifnot`, `each`, `outereach`, `render`, `ko-value`, `ko-checked`, `ko-style`,
  `ko-disabled`, `ko-focused`, `ko-scope`, `translate`, `outerfasteach`, and
  registered UI bindings such as `afterRender`, `bindHtml`, and `simple-checked`.

Magento performs its normal shorthand conversion; instrumentation does not
replace its renderer. Custom bindings work through `data-bind` and virtual KO
syntax. Custom shorthand names must be added to the package's source mapping.
Bindings whose preprocessors rename/remove the declaration are rejected when
they cannot be mapped (the standard `textinput` alias is supported).

## Prepare an isolated Magento copy

First prepare a disposable Magento environment using your normal test runner.
The example below assumes the original Magento root is `src` and its disposable
`app/code` and `app/design` copies live under `coverage/template-copy`.
Run the CLI from the directory where the npm package is installed; adjust paths
to match your source and copies.

```sh
npx --no-install magento-template-coverage inventory \
  --source src --manifest coverage/template-manifest.json

npx --no-install magento-template-coverage instrument \
  --source src --manifest coverage/template-manifest.json \
  --map app/code=coverage/template-copy/app-code \
  --map app/design=coverage/template-copy/app-design
```

The default inventory roots are `app/code` and `app/design`. Use repeated `--root`
arguments to select different roots, and provide corresponding `--map` arguments.
The instrument command writes only supported HTML files. The caller prepares the
rest of the application and configures the test server to use these copies.

Instrumentation refuses destinations inside the original Magento tree, symlinked
or overlapping destinations, and inputs changed since inventory. It never edits
source templates in place. Repeating it starts from the original source and does
not stack markers. IDs contain a source-path/content hash, so theme overrides
remain distinct and stale hits are rejected. Use fresh static assets and caches.

## Collect in Cypress

Register once in your coverage-enabled Cypress support file:

```js
const { registerTemplateCoverage } = require('@vitaliiboiko/magento-template-coverage/cypress');

registerTemplateCoverage({ outputDir: '.template-coverage' });
```

Each test writes a uniquely named `.mtc` file. Files contain JSON but deliberately
use a separate extension so they can share an artifact volume with Istanbul
without being mistaken for JavaScript coverage maps. For parallel runs, use a
separate output directory or volume per shard and gather them beneath a common
directory. Preserve the manifest produced for that run alongside the records.

Generate a standalone HTML and JSON report:

```sh
npx --no-install magento-template-coverage report \
  --manifest coverage/template-manifest.json \
  --hits .template-coverage \
  --output coverage/templates
```

`--hits` is searched recursively. The report contains every inventoried template,
including those no test loaded. Supported browser templates with no observations
are uncovered. Other template types are listed as unsupported and excluded from
the percentage. With no collected records, the report explicitly identifies
itself as an inventory baseline, not a completed coverage run.

## Coverage boundaries

- The denominator includes all physical browser templates in the selected roots,
  including inactive modules, Admin templates, and overridden templates. Active
  theme/store/locale applicability and vendor fallback are not resolved yet.
  Symlinked source trees are rejected rather than silently skipped.
- PHP `.phtml` files, email templates, and other HTML outside browser template
  directories are inventoried as unsupported. Continue using PCOV for PHP
  execution coverage. Database CMS/email content is not inventoried.
- Page Builder browser templates require Admin authoring tests. Viewing previously
  saved storefront content does not show that an authoring template ran.
- Inline templates in PHP/JS, shadow roots, child frames/cross-origin pages,
  visibility, condition outcomes, and sanitizers/minifiers that strip comments
  are outside this release's scope. Underscore templates receive DOM coverage
  only and are explicitly labelled; their generated bindings cannot be mapped
  reliably to original source statements.
- Automatic binding execution collection supports the standard Knockout 3.5
  binding provider loaded through RequireJS. Register Cypress support before
  navigation. Custom binding providers without `parseBindingsString` and
  application code that replaces the provider after startup need explicit integration.
- Old cached, uninstrumented HTML cannot emit markers. DOM observation introduces
  overhead during coverage runs. Keep source-path reports in test artifacts.

## Package development

```sh
npm test
npm run test:browser -- /path/to/magento /path/to/cypress/node_modules/cypress
npm pack --dry-run
```

The browser harness starts a temporary HTTP fixture server and runs headless
Electron (or set `CYPRESS_BROWSER=chrome`). It reads the supplied checkout's real Magento template loader/renderer,
Knockout, `mage/template`, and stock modal template. It neither boots Magento nor
accesses a database, and does not copy Magento code into the published package.
The exact collected source IDs, binding hits, false-body zeros, two-way writes,
conditional rerenders, and retained-page counter resets are checked after the tests.

Browser test artifacts default to `coverage/browser`; pass a third positional
argument after the Cypress module path to change that directory. These tests
validate the browser fixture, not a full Magento checkout flow.

The published tarball contains only `bin/`, `lib/`, `cypress/`, this README, and
package metadata. `npm publish` runs the unit tests before publishing. The adapter
uses standard Cypress lifecycle events and DOM APIs without calling RequireJS
modules from Cypress tests.
