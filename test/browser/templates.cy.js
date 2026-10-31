// SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
// SPDX-License-Identifier: MIT
// License: see LICENSE in the repository root.

const selectors = require('./selectors.json');

describe('legacy admin compatibility', () => {
    it('preserves Prototype DOM extensions when observation starts before the legacy bundle', () => {
        cy.visit('/');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.visit('/legacy.html');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.get(selectors.legacyContent).should('be.visible');
        cy.get(selectors.legacyToggle).click();
        cy.get(selectors.legacyContent).should('not.be.visible');
        cy.get(selectors.legacyToggle).click();
        cy.get(selectors.legacyContent).should('be.visible');
    });
});

describe('browser template coverage', () => {
    it('ignores fetched, detached, unused and inert nested templates', () => {
        cy.visit('/');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.get(selectors.panel).should('not.exist');
        cy.get(selectors.modal).should('not.exist');
    });

    it('tracks nested Knockout, cached rerenders and the real Magento modal', () => {
        cy.visit('/');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.get(selectors.openPanel).click();
        cy.get(selectors.panel).should('be.visible').and('contain.text', 'Nested');
        cy.get(selectors.openPanel).click();
        cy.get(selectors.panel).should('not.exist');
        cy.get(selectors.openPanel).click();
        cy.get(selectors.panel).should('be.visible');
        cy.get(selectors.openModal).click();
        cy.get(selectors.modal).should('be.visible').and('contain.text', 'Application modal');
    });

    it('retains observations across real page navigation', () => {
        cy.visit('/');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.get(selectors.openPanel).click();
        cy.get(selectors.panel).should('be.visible');
        cy.get(selectors.next).click();
        cy.get(selectors.second).should('be.visible');
    });

    it('handles table fragments, hidden content and immediate removal', () => {
        cy.visit('/');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.get(selectors.transient).click();
        cy.get(selectors.transientContent).should('not.exist');
        cy.get(selectors.table).click();
        cy.get(selectors.row).should('have.text', 'Table fragment');
        cy.get(selectors.hidden).click();
    });
});

describe('retained document', { testIsolation: false }, () => {
    before(() => {
        cy.visit('/');
        cy.get(selectors.ready).should('have.text', 'Ready');
    });

    it('initializes the retained document', () => {
        cy.visit('/');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.window().then(win => {
            delete win.__mtcTemplateHit;
            expect(win.__mtcTemplateHit).to.equal(undefined);
        });
    });

    it('restores a deleted helper on a retained document', () => {
        cy.window().its('__mtcTemplateHit').should('be.a', 'function');
        cy.get(selectors.openPanel).click();
        cy.get(selectors.panel).should('be.visible');
        cy.get(selectors.openModal).click();
        cy.get(selectors.modal).should('be.visible').and('contain.text', 'Application modal');
    });
});

describe('Knockout binding execution', () => {
    it('leaves false conditional bodies and empty loops uncovered', () => {
        cy.visit('/bindings.html');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.get('#custom-if-child, #outer-if, #inner-if-child, #virtual-child, .custom-item, .inner-item, .outer-item, #never-evaluated').should('not.exist');
        cy.get('#ifnot-child, #custom-ifnot-child').should('have.length', 2);
        cy.get('#bare-bindings, #empty-shorthand').each(node => expect(node.text()).to.equal('undefined'));
        cy.get('#entity').should('have.text', 'one & two').and('have.attr', 'title', '"quoted"');
    });

    it('preserves writes and measures Magento shorthand and conditional rerenders', () => {
        cy.visit('/bindings.html');
        cy.get(selectors.ready).should('have.text', 'Ready');
        cy.get('#plain-value').clear().type('changed').blur();
        cy.get('#magento-value').clear().type('shorthand changed').blur();
        cy.get('#checked').check();
        cy.window().then(win => {
            expect(win.fixtureModel.plain).to.equal('changed');
            expect(win.fixtureModel.plainShorthand).to.equal('shorthand changed');
            expect(win.fixtureModel.checked()).to.equal(true);
        });
        cy.get('#open-panel').click();
        cy.get('#custom-if-child, #outer-if, #inner-if-child, #virtual-child').should('have.length', 4);
        cy.get('#ifnot-child, #custom-ifnot-child').should('not.exist');
        cy.get('#populate').click();
        cy.get('.custom-item, .inner-item, .outer-item').should('have.length', 6);
        cy.get('#open-panel').click().click();
        cy.get('#virtual-child').should('have.text', 'template');
        cy.get('#never-evaluated').should('not.exist');
    });
});

describe('HTML template engines', () => {
    beforeEach(() => { cy.visit('/engines.html'); cy.get('#ready').should('have.text', 'Ready'); });
    it('leaves prefetched engines and inert HTML bodies unexecuted', () => {
        cy.get('#engine-output').should('be.empty');
        cy.get('.inline-result, .native-result').should('not.exist');
    });
    it('counts cached Underscore renders and keeps false branches uncovered', () => {
        cy.get('#render-underscore').click().click();
        cy.get('.underscore-output strong').should('have.text', '<Title>');
        cy.get('.underscore-output li').should('have.length', 2);
    });
    it('renders legacy jQuery conditions loops escaped values and nested templates', () => {
        cy.get('#render-jquery').click();
        cy.get('.jquery-output strong').should('have.text', '<Title>');
        cy.get('.jquery-output li').should('have.length', 2);
        cy.get('.jquery-output em').should('have.text', 'Trusted markup');
        cy.get('.jquery-child').should('have.text', 'Nested child');
    });
    it('renders Magento literals and consumes inert HTML templates', () => {
        cy.get('#render-literal').click();
        cy.get('.literal-output').should('have.text', 'Magento literal');
        cy.window().its('literalCalls').should('eq', 1);
        cy.get('#render-inline').click();
        cy.get('.inline-result').should('have.text', '<Title>');
        cy.get('.native-result').should('have.text', 'Native HTML');
    });
});


describe('inline template scripts', {testIsolation: false}, () => {
    before(() => cy.visit('/scripts.html'));
    it('measures inline scripts and scripts inserted from cached templates', () => {
        cy.visit('/scripts.html');
        cy.window().then(win => {
            expect(win.__coverage__).to.equal(undefined);
            expect(win.inserted).to.equal(undefined);
            expect(win.neverInserted).to.equal(undefined);
            win.document.body.appendChild(win.document.querySelector('#script-cache').content.cloneNode(true));
            win.document.body.appendChild(win.document.querySelector('#script-cache').content.cloneNode(true));
            expect(win.inserted).to.equal(2);
        });
        cy.get('#script-call').click();
        cy.window().its('calls').should('eq', 1);
    });
    it('resets inline script counts on a retained page', () => {
        cy.get('#script-call').click();
        cy.window().its('calls').should('eq', 2);
        cy.window().then(win => expect(win.__coverage__).to.equal(undefined));
    });
});

describe('PHP child template output', () => {
    it('links PHP child templates without recording execution', () => {
        cy.visit('/generated-parent.phtml');
        cy.get('#generated-call').should('be.visible');
        cy.window().then(win => expect(win.childResult).to.equal(undefined));
    });

    it('executes child templates at their original locations', () => {
        cy.visit('/generated-parent.phtml');
        cy.get('#generated-call').click();
        cy.window().then(win => {
            expect(win.childResult).to.equal('yes');
            win.generatedRun(false);
            expect(win.childResult).to.equal('no');
            expect(win.childNever).to.equal(undefined);
            expect(win.__coverage__).to.equal(undefined);
        });
    });

    it('retains empty and unknown PHP output across navigation', () => {
        cy.visit('/generated-parent.phtml?mode=empty');
        cy.get('#generated-call').click();
        cy.visit('/generated-parent.phtml?mode=unknown');
        cy.get('#generated-call').click();
        cy.window().its('unknownOutput').should('equal', true);
    });
});


describe('strict CSP Alpine', () => {
    it('preserves CSP bindings, writes, event arguments, loops and inserted templates', () => {
        for (const file of ['csp-baseline.html', 'csp.html']) {
            const violations = [];
            cy.visit('/' + file, {onBeforeLoad(win) {
                win.document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
            }});
            cy.get('#initialized').should('have.text', 'ready');
            cy.get('#name').clear().type('updated');
            cy.get('#echo').should('have.text', 'updated');
            cy.get('#increment').click();
            cy.get('#async').click();
            cy.get('#count').should('have.text', '2');
            cy.get('.item').should('have.length', 2);
            cy.get('#never').should('not.exist');
            cy.get('#insert').click();
            cy.get('#inserted').should('have.text', 'updated');
            cy.window().then(win => {
                win.dispatchEvent(new win.CustomEvent('update-gallery-42', {detail: 'gallery-updated'}));
                win.dispatchEvent(new win.CustomEvent('update-prices-42', {detail: 'price-updated'}));
                const event = new win.Event('submit', {bubbles: true, cancelable: true});
                win.document.querySelector('#prevented').dispatchEvent(event);
                expect(event.defaultPrevented).to.equal(true);
            });
            cy.get('#image').should('have.text', 'gallery-updated');
            cy.get('#price').should('have.text', 'price-updated');
            cy.then(() => expect(violations).to.deep.equal([]));
        }
    });
});
