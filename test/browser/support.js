const { registerTemplateCoverage } = require('../../cypress/support');

registerTemplateCoverage({ outputDir: Cypress.config('downloadsFolder') });
