# Repository guide for AI coding agents

## Project identity and scope

`@vitaliiboiko/magento-template-coverage` measures Magento 2 HTML/PHTML template execution from Cypress and Playwright tests. It supports Knockout bindings, jQuery/Underscore/Magento literal templates, Hyvä/Alpine directives and inline JavaScript, with separate DOM-presence reporting.

Read [README.md](README.md) for integration and metric semantics, and [CHANGELOG.md](CHANGELOG.md) for format/behavior changes. This CommonJS Node package is distinct from MageLens, which installs Magento and combines PHP, JavaScript and template reports. This package does not install Magento or measure PHP execution.

## Architecture and navigation

| Path | Responsibility |
| --- | --- |
| `package.json` | Public exports, CLI, published files, dependency pins and test scripts |
| `bin/cli.js` | Inventory/instrument/report CLI dispatch |
| `lib/index.js` | Manifest creation/validation, disposable instrumentation, hit-record merge and public API |
| `lib/template.js`, `lib/statements.js` | Template analysis, source locations and binding statement maps |
| `lib/engines.js`, `lib/alpine.js` | Template engine handling and Alpine/PHTML analysis |
| `lib/inline-scripts.js`, `lib/generated-scripts.js` | Inline script instrumentation and PHP-generated child-source references |
| `lib/execution.js`, `lib/engines-runtime.js` | Browser-side execution observers/runtime |
| `lib/browser.js` | DOM template-presence and reference observations |
| `lib/browser-source.js` | Embeds the small shared browser runtime for Playwright; not a general bundler |
| `lib/report.js` | HTML reports and coverage summaries |
| `cypress/support.js` | Cypress hooks/collection |
| `playwright/index.js`, `playwright/index.d.ts` | Runtime installation, context collection, fixture wrapper and public types |
| `test/*.test.js` | Node unit/behavior tests, including PHP-rendered PHTML cases |
| `test/playwright/`, `test/csp-fixture.js`, `test/generated-fixture.js` | Real-browser behavior, CSP and generated-script fixtures |
| `test/browser/` | Cypress harness using assets from a supplied Magento checkout |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml` | CI and npm release automation |

Data flow: inventory original sources → analyze and hash a manifest → instrument separate disposable roots → collect DOM IDs and execution counters → merge against that manifest → report. The public exports include the package root plus `/browser`, `/cypress` and `/playwright`; preserve their compatibility.

## Install and validate

Run from the repository root. Package metadata requires Node >=18.3; CI tests Node 24 and 26, including before npm publication. Use the committed npm lockfile. PHP CLI must be on PATH for PHTML behavior tests.

```sh
npm ci
npm test
npm run test:types
npx playwright install --with-deps chromium
npm run test:playwright
npm pack --dry-run
```

These are the CI commands. Browser installation downloads Chromium and may install system dependencies; use a suitable development/CI environment. `npm test` runs `node --test test/*.test.js`, not the browser suites. A targeted example is `node --test test/alpine.test.js`. `npm run test:types` checks the Playwright declaration API against `test/playwright/types.ts`.

The additional Cypress integration command is:

```sh
npm run test:browser -- /path/to/magento /path/to/cypress/node_modules/cypress
```

Replace both paths with real installed resources. The harness reads Magento UI assets and uses a separate Cypress installation; it is not covered by a default `npm test` run and Cypress is not a package devDependency. See `test/browser/run.js` for the optional artifact-directory argument. Do not claim Magento/Cypress validation from the Playwright fixture suite alone.

There is no `npm run build` or lint script. Source is shipped directly; inspect `npm pack --dry-run` for packaging changes. Publishing is a separate release action, not a validation step.

## Correctness boundaries

- Never instrument original source roots. Preserve preflight validation of every source/destination, source digests, no-overlap rules, symlink rejection and rename-based writes that protect hardlinked originals.
- Preserve PHP tokens, strict declarations and original line numbers. Unsupported dynamic syntax must remain visible as a limitation; never invent a source mapping or claim it executed.
- Keep DOM presence separate from template execution. Hidden attached nodes can count as present; downloaded HTML alone cannot. A binding-evaluation hit does not prove its event handler ran.
- Retain zero-hit baselines for unused templates, inline functions and branches. Inline scripts belong to this template report, not the consumer's whole-file JavaScript coverage.
- Keep schema/identity validation, duplicate-record handling and stale/unknown counter rejection. Changes to analysis/statement maps must stay consistent with manifest validation and record merge.
- Preserve strict CSP behavior, evaluator scope, event arguments, loop locals and model getter/setter behavior. Do not weaken CSP or use unsafe evaluation to make instrumentation pass.
- Browser runtime modules must remain free of Node-only parser/filesystem dependencies; `browser-source.js` embeds only the small runtime module set.
- Register Playwright collection before navigation, flush across page/frame navigation and closure, and preserve fixture teardown. Warm-up/login contexts may install runtime without recording hits. Keep wrapper method restoration and duplicate-context protection.
- Keep JavaScript implementation, public TypeScript declarations, CLI behavior and README examples aligned when changing APIs.

## Test selection and review

Use core tests for manifest/path/merge changes; Alpine, engine and inline-script tests for transformation changes; and Playwright/CSP tests for actual browser semantics. Add regressions that compare original and instrumented behavior, including uncovered branches and unsupported cases. Exercise Cypress separately when changing shared runtime or Cypress integration.

Do not add generated reports, dependencies or tarballs to commits. Do not change versions or publish npm releases unless requested. Prefer package metadata over potentially older README install-version examples. In PRs state the commands actually run and any unavailable PHP, browser or Magento prerequisites. Documentation-only changes require verified paths, scripts and diff scope, not a runtime-test claim.
