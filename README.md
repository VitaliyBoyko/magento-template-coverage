# Magento template coverage

Browser template DOM coverage for isolated Magento test environments. This early
release provides an npm CLI and Cypress adapter with no runtime dependencies.
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

## What coverage means

The CLI inventories `.html` and `.phtml` files in selected Magento source roots.
It prepends a source marker to browser HTML under `web/template/` and
`web/templates/` in a disposable copy. A Cypress adapter observes these comments
entering the application document using MutationObserver.

Knockout, Magento's HTML binding syntax, and Underscore templates are supported
when they preserve HTML comments. Downloading a template, parsing a detached
fragment, or keeping a template inside an inert script/template element does not
count as coverage. Nested templates count when their markers enter the document.
Observations survive navigation and can be merged across tests and shards.

The metric is **template DOM presence**, separate from Istanbul statement/line
coverage. A hit does not establish visibility, assertions, branch coverage,
successful binding completion, or correctness. Hidden content counts. Observation
counts represent test records containing a template, not renderer invocations.

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

## Prototype boundaries

- The denominator includes all physical browser templates in the selected roots,
  including inactive modules, Admin templates, and overridden templates. Active
  theme/store/locale applicability and vendor fallback are not resolved yet.
  Symlinked source trees are rejected rather than silently skipped.
- PHP `.phtml` files, email templates, and other HTML outside browser template
  directories are inventoried as unsupported. Continue using PCOV/Xdebug for PHP
  execution coverage. Database CMS/email content is not inventoried.
- Page Builder browser templates require Admin authoring tests. Viewing previously
  saved storefront content does not show that an authoring template ran.
- Inline templates in PHP/JS, shadow roots, child frames/cross-origin pages,
  visibility, condition outcomes, and sanitizers/minifiers that strip comments
  are outside this release's scope.
- Old cached, uninstrumented HTML cannot emit markers. DOM observation introduces
  overhead during coverage runs. Keep source-path reports in test artifacts.

## Package development

```sh
npm test
npm run test:browser -- /path/to/magento /path/to/cypress/node_modules/cypress
npm pack --dry-run
```

The browser harness starts a temporary HTTP fixture server and runs headless
Chrome. It reads the supplied checkout's real Magento template loader/renderer,
Knockout, `mage/template`, and stock modal template. It neither boots Magento nor
accesses a database, and does not copy Magento code into the published package.
The exact collected source IDs are checked after the browser tests.

Browser test artifacts default to `coverage/browser`; pass a third positional
argument after the Cypress module path to change that directory. These tests
validate the browser fixture, not a full Magento checkout flow.

The published tarball contains only `bin/`, `lib/`, `cypress/`, this README, and
package metadata. `npm publish` runs the unit tests before publishing. The adapter
uses standard Cypress lifecycle events and DOM APIs without calling RequireJS
modules from Cypress tests.
