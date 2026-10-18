'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

const parent = `<?php declare(strict_types=1); ?>
<button id="generated-call" onclick="window.generatedRun(true)">Run child</button>
<script>
window.generatedRun = function (enabled) {
<?= $block->renderChild() ?>
};
</script>`;
const child = `<?php declare(strict_types=1); ?>
<?php if (false): ?><script><?php endif; ?>
function childChoice(value) { if (value) { window.childResult = 'yes'; } else { window.childResult = 'no'; } }
function childUnused() { window.childNever = true; }
childChoice(enabled);
<?php if (false): ?></script><?php endif; ?>`;

function writeFixtures(directory) {
    fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(path.join(directory, 'generated-parent.phtml'), parent);
    fs.writeFileSync(path.join(directory, 'generated-child.phtml'), child);
}

function render(directory, mode = 'child') {
    const bootstrap = `<?php
class GeneratedBlock {
    public $calls = 0;
    public function renderChild() {
        $this->calls++;
        if ($GLOBALS['argv'][2] === 'empty') return '';
        if ($GLOBALS['argv'][2] === 'unknown') return 'window.unknownOutput = true;';
        ob_start(); include $GLOBALS['argv'][1] . '/generated-child.phtml'; return ob_get_clean();
    }
}
$block = new GeneratedBlock();
include $argv[1] . '/generated-parent.phtml';
if ($block->calls !== 1) throw new RuntimeException('Child expression evaluated more than once');
`;
    const file = path.join(directory, 'render.php');
    fs.writeFileSync(file, bootstrap);
    return execFileSync('php', ['-n', file, directory, mode], {encoding: 'utf8', timeout: 10000});
}

function parseReferences(html) {
    return [...html.matchAll(/\/\*mtc-ref:([a-f0-9]{32}):(script:\d+:g:\d+):([a-f0-9]+)\*\//g)].map(([, template, fragment, data]) =>
        ({template, fragment, ...JSON.parse(Buffer.from(data, 'hex').toString())}));
}

module.exports = {writeFixtures, render, parseReferences};
