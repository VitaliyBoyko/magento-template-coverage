'use strict';

/** Observe source markers in the application document, never detached template caches. */
function observeTemplates(win, onHit) {
    const seen = new WeakSet();
    const pattern = /^mtc:([a-f0-9]{32})$/;

    function inspect(node) {
        if (node.nodeType !== 8 || seen.has(node)) return;
        const match = pattern.exec(node.nodeValue);
        if (match) {
            seen.add(node);
            onHit(match[1]);
        }
    }

    function scan(root) {
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

module.exports = { observeTemplates };
