'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createManifest, instrument, merge, readRecords, writeReport } = require('../../lib');

// Read dependencies from a supplied Magento checkout without booting or changing it.
if (!process.argv[2]) {
    console.error('Usage: npm run test:browser -- <Magento root> [Cypress module] [artifact directory]');
    process.exit(1);
}
const magento = path.resolve(process.argv[2]);
const cypressModule = path.resolve(process.argv[3] || path.join(magento, 'cypress/node_modules/cypress'));
const output = path.resolve(process.argv[4] || path.join(__dirname, '../../coverage/browser'));

async function main() {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'magento-template-browser-'));
    const source = path.join(temporary, 'source');
    const copy = path.join(temporary, 'instrumented');
    const root = 'app/code/Example/Demo/view/frontend/web/template';
    const templatePaths = {};
    const fixtures = {
        root: '<button id="open-panel" data-bind="click: toggle">Toggle panel</button><if args="open"><div data-bind="template: {name: \'nested-cache\', data: $data}"></div></if>',
        nested: '<div id="panel">Nested <span data-bind="text: message"></span></div>',
        prefetched: '<div>Fetched but never parsed or rendered</div>',
        detached: '<div>Parsed but only kept in a detached fragment</div>',
        unused: '<div>Never even requested</div>',
        second: '<div id="second-page">Second page</div>',
        transient: '<div id="transient-content">Removed in the same event loop turn</div>',
        row: '<tr id="table-row"><td>Table fragment</td></tr>',
        hidden: '<div hidden>Attached but hidden: this metric is DOM presence</div>'
    };
    const modalPath = 'app/design/frontend/example/theme/Magento_Ui/web/templates/modal/modal-popup.html';
    fs.mkdirSync(path.join(source, root), { recursive: true });
    for (const [name, content] of Object.entries(fixtures)) {
        templatePaths[name] = `${root}/${name}.html`;
        fs.writeFileSync(path.join(source, templatePaths[name]), content);
    }
    templatePaths.modal = modalPath;
    fs.mkdirSync(path.dirname(path.join(source, modalPath)), { recursive: true });
    fs.copyFileSync(path.join(magento, 'vendor/magento/module-ui/view/base/web/templates/modal/modal-popup.html'), path.join(source, modalPath));
    const manifest = createManifest({ source });
    instrument({ source, manifest, mappings: {
        'app/code': path.join(copy, 'app/code'),
        'app/design': path.join(copy, 'app/design')
    } });
    fs.mkdirSync(output, { recursive: true });
    const hits = path.join(output, `hits-${Date.now()}`);
    fs.mkdirSync(hits);

    const app = `
require.config({baseUrl:'/lib',paths:{ko:'knockoutjs/knockout',text:'requirejs/text',Magento_Ui:'/ui','Example_Demo/template':'/templates'}});
require(['jquery','ko','mage/template','Magento_Ui/js/lib/knockout/template/renderer'],function($,ko,mageTemplate,renderer){
    Promise.all(['root','nested','prefetched','detached','transient','row','hidden','modal'].map(function(name){
        return fetch('/templates/'+name+'.html').then(function(res){return res.text();}).then(function(html){return [name,html];});
    })).then(async function(entries){
        var templates=Object.fromEntries(entries);
        var detached=await renderer.render('Example_Demo/detached');
        var root=await renderer.render('Example_Demo/root');
        var nested=document.createElement('script');nested.type='text/html';nested.id='nested-cache';nested.textContent=templates.nested;document.body.appendChild(nested);
        var host=document.getElementById('app');root.forEach(function(node){host.appendChild(node);});
        var model={open:ko.observable(false),message:'template'};model.toggle=function(){model.open(!model.open());};ko.applyBindings(model,host);
        document.getElementById('open-modal').onclick=function(){
            document.getElementById('modal-host').innerHTML=mageTemplate(templates.modal,{data:{type:'popup',modalClass:'',responsive:false,innerScroll:false,title:'Prototype modal',subTitle:'',id:1,closeText:'Close',buttons:[]}});
        };
        document.getElementById('insert-transient').onclick=function(){var box=document.createElement('div');box.innerHTML=templates.transient;document.body.appendChild(box);box.remove();};
        document.getElementById('insert-row').onclick=function(){$('#table-body').append(renderer.parseTemplate(templates.row));};
        document.getElementById('insert-hidden').onclick=function(){document.getElementById('hidden-host').innerHTML=templates.hidden;};
        document.getElementById('ready').textContent='Ready';
    });
});`;
    const page = `<!doctype html><html><head><title>Template coverage fixture</title></head><body>
<div id="ready">Loading</div><div id="app"></div><button id="open-modal">Open modal</button><div id="modal-host"></div>
<button id="insert-transient">Insert and remove</button><button id="insert-row">Insert table row</button><button id="insert-hidden">Insert hidden content</button>
<table><tbody id="table-body"></tbody></table><div id="hidden-host"></div><a id="next-page" href="/second.html">Next page</a>
<script src="/lib/requirejs/require.js"></script><script src="/app.js"></script></body></html>`;

    const server = http.createServer((req, res) => {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(page); return; }
            if (url.pathname === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(app); return; }
            if (url.pathname === '/second.html') {
                res.setHeader('Content-Type', 'text/html');
                res.end(`<!doctype html><html><body>${fs.readFileSync(path.join(copy, templatePaths.second), 'utf8')}</body></html>`);
                return;
            }
            let base;
            let relative;
            if (url.pathname.startsWith('/templates/')) {
                base = copy;
                relative = templatePaths[path.basename(url.pathname, '.html')];
            } else if (url.pathname.startsWith('/lib/')) {
                base = path.join(magento, 'lib/web'); relative = url.pathname.slice(5);
            } else if (url.pathname.startsWith('/ui/')) {
                base = path.join(magento, 'vendor/magento/module-ui/view/base/web'); relative = url.pathname.slice(4);
            }
            if (!base || !relative) { res.writeHead(404); res.end('Not found'); return; }
            const file = path.resolve(base, relative);
            if (!file.startsWith(`${base}${path.sep}`)) { res.writeHead(403); res.end('Forbidden'); return; }
            res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : 'text/html');
            res.end(fs.readFileSync(file));
        } catch (error) {
            res.writeHead(500); res.end(error.message);
        }
    });

    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const result = await require(cypressModule).run({
            project: path.resolve(__dirname, '../..'),
            configFile: 'test/browser/cypress.config.js',
            browser: 'chrome',
            config: {
                video: false,
                screenshotOnRunFailure: false,
                screenshotsFolder: path.join(output, 'screenshots'),
                downloadsFolder: hits,
                e2e: {
                    baseUrl,
                    specPattern: 'test/browser/templates.cy.js',
                    supportFile: 'test/browser/support.js'
                }
            }
        });
        if (result.status === 'failed' || result.totalFailed || result.totalTests !== 6) {
            throw new Error(`Browser fixture failed: ${result.message || `${result.totalFailed} failures`}`);
        }
        const records = readRecords(hits);
        const byTitle = title => records.find(record => record.test.at(-1) === title);
        const ids = names => names.map(name => manifest.templates.find(entry => entry.path === templatePaths[name]).id).sort();
        const expectations = {
            'ignores fetched, detached, unused and inert nested templates': ['root'],
            'tracks nested Knockout, cached rerenders and the real Magento modal': ['root', 'nested', 'modal'],
            'retains observations across real page navigation': ['root', 'nested', 'second'],
            'handles table fragments, hidden content and immediate removal': ['root', 'transient', 'row', 'hidden'],
            'initializes the retained document': ['root'],
            'observes a retained document without navigation': ['root', 'nested']
        };
        assert.equal(records.length, 6);
        for (const [title, names] of Object.entries(expectations)) assert.deepEqual(byTitle(title)?.ids, ids(names), title);
        const report = merge(manifest, records);
        assert.equal(report.summary.covered, 7);
        assert.equal(report.summary.uncovered, 3);
        writeReport(report, path.join(output, 'report'));
        fs.writeFileSync(path.join(output, 'template-manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`Validated browser observations against exact expected template IDs: ${path.join(output, 'report/index.html')}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
