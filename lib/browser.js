'use strict';

// Keep this function self-contained: cross-window callers compile it in the
// application's realm so DOM wrappers inherit the application's prototypes.
function collectTemplates(win, onHit, onReference) {
    const seen = new WeakSet();
    const pattern = /^mtc:([a-f0-9]{32})$/;
    const references = new Set();

    function inspectScripts(root) {
        if (!onReference) return;
        const scripts = root.nodeType === 1 && root.localName === 'script' ? [root] : [];
        if (root.querySelectorAll) for (const script of root.querySelectorAll('script')) scripts.push(script);
        for (const script of scripts) {
            for (const match of script.textContent.matchAll(/\/\*mtc-ref:([a-f0-9]{32}):(script:\d+:g:\d+):([a-f0-9]+)\*\//g)) {
                if (references.has(match[0])) continue;
                const text = match[3].replace(/../g, hex => String.fromCharCode(parseInt(hex, 16)));
                const info = JSON.parse(text);
                references.add(match[0]);
                onReference({template: match[1], fragment: match[2], targets: info.targets, empty: info.empty});
            }
        }
    }

    function inspect(node) {
        if (node.nodeType !== 8 || seen.has(node)) return;
        const match = pattern.exec(node.nodeValue);
        if (match) {
            seen.add(node);
            onHit(match[1]);
        }
    }

    function scan(root) {
        inspectScripts(root.nodeType === 3 ? root.parentNode || root : root);
        inspect(root);
        const walker = win.document.createTreeWalker(root, win.NodeFilter.SHOW_COMMENT);
        let comment;
        while ((comment = walker.nextNode())) inspect(comment);
    }

    function process(records) {
        for (const record of records) {
            for (const node of record.addedNodes) {
                // A subtree may already be removed by this callback. The mutation
                // still proves insertion into the observed document during this turn.
                scan(node);
            }
        }
    }

    const observer = new win.MutationObserver(process);
    observer.observe(win.document, { childList: true, subtree: true });
    scan(win.document);
    return {
        flush() { process(observer.takeRecords()); },
        disconnect() {
            process(observer.takeRecords());
            observer.disconnect();
        }
    };
}

/** Observe source markers in the application document, never detached template caches. */
function observeTemplates(win, onHit, onReference) {
    // A MutationObserver constructed with win.MutationObserver still invokes a
    // callback in the realm where that callback was created. Traversing its nodes
    // from Cypress can create wrappers without Magento's Prototype DOM extensions.
    const collect = win.Function === Function
        ? collectTemplates
        : win.Function(`return (${collectTemplates.toString()});`)();

    return collect(win, onHit, onReference);
}

module.exports = { observeTemplates, ...require('./execution') };
