// Match Magento's cross-origin checkout test environment. With web security
// disabled, DOM wrappers first accessed from Cypress can inherit its prototypes.
module.exports = { chromeWebSecurity: false, modifyObstructiveCode: false, experimentalCspAllowList: ['default-src', 'script-src', 'script-src-elem'], e2e: {} };
