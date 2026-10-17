import {test as base} from '@playwright/test';
import {withTemplateCoverage, registerTemplateCoverage} from '../../playwright';
const custom = base.extend<{customer: string}>({customer: async ({}, use) => use('customer')});
const test = withTemplateCoverage(custom, {outputDir: '.template-coverage'});
test.use({templateCoverageOptions: {outputDir: 'coverage/templates'}});
test('keeps consumer fixture types', async ({customer, page, context, templateCoverageOptions}) => {
    customer.toUpperCase();
    templateCoverageOptions.outputDir?.toUpperCase();
    await page.goto('about:blank');
    const collector = await registerTemplateCoverage(context);
    await collector.stop();
});
