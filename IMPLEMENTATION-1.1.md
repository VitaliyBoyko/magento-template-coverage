# 1.1.0 implementation

1. Build directory summaries, directory pages and breadcrumbs from the same merged counters as source reports. Keep an optional searchable flat list and offline relative links.
2. Inventory only .html files, at any location under configured roots. Extend disposable HTML instrumentation to Underscore/mage-template expressions and evaluation code, legacy jQuery tmpl directives, Magento UI template literals, and inert inline template bodies. Keep DOM presence independent from execution, and expose engine overrides for ambiguous syntax.
3. Verify source locations, untouched originals, false branches, loops, cached renderers, plain HTML, nested templates, escaping and runtime equivalence with unit tests and real browser engines.
4. Release 1.1.0, install the immutable published package here, run the complete Magento workflow twice and inspect the directory/source reports and current-run badges.

Only physical .html files are inventoried. PHP and JavaScript files are excluded entirely. Server-rendered directives in .html files retain DOM presence only; no browser-execution lines are invented.
