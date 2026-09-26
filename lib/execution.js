'use strict';

const windows = new WeakMap();
const { helper } = require('./engines-runtime');

function installJqueryTemplates(jquery) {
    if (!jquery?.tmpl?.tag) return false;
    if (jquery.tmpl.tag.mtc && jquery.tmpl.tag.mtc.open !== '$1;') {
        throw new Error('The jQuery template tag "mtc" is reserved for coverage');
    }
    jquery.tmpl.tag.mtc = { open: '$1;' };
    return true;
}

/** Instrument accessors AFTER Knockout parses expressions and creates property writers. */
function installKnockout(ko, onHit) {
    const provider = ko?.bindingProvider?.instance;
    if (!provider || typeof provider.parseBindingsString !== 'function') return false;
    const original = provider.parseBindingsString;
    provider.parseBindingsString = function (source, context, node, options) {
        const result = original.apply(this, arguments);
        const markers = [...source.matchAll(/\/\*mtc_([a-f0-9]{32})_(\d+)_([a-f0-9]+)\*\//g)];
        for (const [, template, statement, encoded] of markers) {
            const binding = decodeURIComponent(encoded.replace(/../g, part => `%${part}`));
            const key = binding === 'textinput' ? 'textInput' : binding;
            if (!Object.hasOwn(result, key)) {
                throw new Error(`Template coverage cannot track preprocessed binding: ${binding}`);
            }
            if (options?.valueAccessors) {
                const accessor = result[key];
                result[key] = function () {
                    onHit(template, statement);
                    return accessor.apply(this, arguments);
                };
            } else {
                // getBindings() evaluates its values eagerly inside the original provider.
                onHit(template, statement);
            }
        }
        return result;
    };
    return true;
}

/** Attach before RequireJS consumers receive Knockout; never require application modules ourselves. */
function observeExecution(win, onHit) {
    let state = windows.get(win);
    // WindowProxy identity can survive navigation while its document/globals change.
    if (!state || state.document !== win.document) {
        state = { previousHelper: state && win[helper] === state.helper, document: win.document, onHit, modules: new WeakSet(), loaders: new WeakSet() };
        windows.set(win, state);
        if (win[helper] !== undefined && !state.previousHelper) throw new Error(`Template coverage global already exists: ${helper}`);
        Object.defineProperty(win, helper, { configurable: true, value(template, statement) {
            state.onHit?.(template, statement);
        } });
        state.helper = win[helper];
        const attach = module => {
            installJqueryTemplates(module);
            if (!module || (typeof module !== 'object' && typeof module !== 'function') || state.modules.has(module)) return;
            if (installKnockout(module, (template, statement) => state.onHit?.(template, statement))) state.modules.add(module);
        };
        const loader = requirejs => {
            if (typeof requirejs !== 'function' || state.loaders.has(requirejs)) return;
            state.loaders.add(requirejs);
            const wrap = callback => function (context, map) {
                attach(context.defined[map.id]);
                // Legacy plugins may return undefined and instead extend jQuery.
                attach(context.defined.jquery);
                attach(win.jQuery);
                return callback?.apply(this, arguments);
            };
            let current = wrap(requirejs.onResourceLoad);
            Object.defineProperty(requirejs, 'onResourceLoad', {
                configurable: true, enumerable: true,
                get() { return current; },
                set(value) { if (value !== current) current = wrap(value); }
            });
            for (const context of Object.values(requirejs.s?.contexts || {})) {
                for (const module of Object.values(context.defined)) attach(module);
            }
        };
        const watch = (key, consume) => {
            let value = win[key];
            consume(value);
            const descriptor = Object.getOwnPropertyDescriptor(win, key);
            if (descriptor && !descriptor.configurable) return;
            Object.defineProperty(win, key, {
                configurable: true, enumerable: descriptor?.enumerable ?? true,
                get() { return value; },
                set(next) { value = next; consume(next); }
            });
        };
        watch('requirejs', loader);
        watch('ko', attach);
        watch('jQuery', attach);
    }
    state.onHit = onHit;
    return { disconnect() { if (state.onHit === onHit) state.onHit = undefined; } };
}

module.exports = { installKnockout, installJqueryTemplates, observeExecution };
