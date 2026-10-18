'use strict';

// Observe without dynamic code generation so strict CSP remains enforced.
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
    if (win.Function === Function) return collectTemplates(win, onHit, onReference);
    // Keep DOM callbacks in the application's realm. Cross-window traversal can
    // otherwise give Magento Admin elements prototypes from the Cypress frame.
    // A nonce-authorized script works under strict CSP without dynamic eval.
    const script = win.document.createElement('script');
    const nonce = win.document.currentScript?.nonce || win.document.querySelector('script[nonce]')?.nonce;
    if (nonce) script.nonce = nonce;
    const key = '__mtcObserve_' + Math.random().toString(36).slice(2);
    script.textContent = `window[${JSON.stringify(key)}] = (${collectTemplates.toString()});`;
    let collect;
    try {
        (win.document.head || win.document.documentElement).appendChild(script);
        collect = win[key];
    } finally { script.remove(); delete win[key]; }
    if (typeof collect !== 'function') throw new Error('Template coverage needs an authorized observer script. Preserve Cypress script nonces when using CSP.');
    return collect(win, onHit, onReference);
}

module.exports = { observeTemplates, ...require('./execution') };
