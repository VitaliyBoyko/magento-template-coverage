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
    });

    it('observes a retained document without navigation', () => {
        cy.get(selectors.openPanel).click();
        cy.get(selectors.panel).should('be.visible');
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
