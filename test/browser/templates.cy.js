const selectors = require('./selectors.json');

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
        cy.get(selectors.modal).should('be.visible').and('contain.text', 'Prototype modal');
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
    });

    it('observes a retained document without navigation', () => {
        cy.get(selectors.openPanel).click();
        cy.get(selectors.panel).should('be.visible');
    });
});
