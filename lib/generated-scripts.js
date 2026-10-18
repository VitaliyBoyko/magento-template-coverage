'use strict';

const PhpParser = require('php-parser');

// Evaluate the original expression once, in its original PHP scope. Only the
// resulting string enters this closure; no application variables are captured.
function traceGeneratedOutput(source, template, fragment) {
    const ast = new PhpParser({ast: {withPositions: true}}).parseCode(source);
    const output = ast.children[0];
    if (ast.children.length !== 1 || output.kind !== 'echo' || output.expressions.length !== 1) return null;
    const expression = output.expressions[0];
    const prefix = `(static function ($__mtcOutput) { $__mtcOutput = (string) $__mtcOutput; ` +
        `preg_match_all('/__mtcTemplateHit\\("([a-f0-9]{32})"/', $__mtcOutput, $__mtcMatches); ` +
        `$__mtcInfo = array('targets' => array_values(array_unique($__mtcMatches[1])), 'empty' => trim($__mtcOutput) === ''); ` +
        `return '/*mtc-ref:${template}:${fragment}:' . bin2hex(json_encode($__mtcInfo)) . '*/' . $__mtcOutput; })(`;
    return source.slice(0, expression.loc.start.offset) + prefix + source.slice(expression.loc.start.offset, expression.loc.end.offset) + ')' + source.slice(expression.loc.end.offset);
}

module.exports = {traceGeneratedOutput};
