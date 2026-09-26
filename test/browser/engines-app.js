require.config({baseUrl: '/lib', paths: {ko: 'knockoutjs/knockout', underscore: 'underscore', jquerytmpl: '/jquery.tmpl'}, shim: {jquerytmpl: {deps: ['jquery']}}});
require(['jquery', 'underscore', 'ko', 'mage/template', 'mage/utils/template', 'jquerytmpl'], function ($, _, ko, mageTemplate, literals) {
    Promise.all(['underscore', 'jquery', 'jquery-child', 'literal', 'inline'].map(function (name) {
        return fetch('/templates/' + name + '.html').then(function (res) { return res.text(); }).then(function (html) { return [name, html]; });
    })).then(function (entries) {
        var templates = Object.fromEntries(entries), host = document.getElementById('app');
        host.innerHTML = '<button id="render-underscore">Underscore</button><button id="render-jquery">jQuery</button><button id="render-literal">Literal</button><button id="render-inline">Inline HTML</button><div id="engine-output"></div>';
        host.insertAdjacentHTML('beforeend', templates.inline);
        var compiled = _.template(templates.underscore), data = {visible: true, title: '<Title>', items: ['one', 'two'], raw: '<em>Trusted markup</em>', child: {name: 'Nested child'}, neverExecuted: function () {throw new Error('False branch executed');}};
        $.template('child', templates['jquery-child']);
        $.template('parent', templates.jquery);
        document.getElementById('render-underscore').onclick = function () { document.getElementById('engine-output').innerHTML = compiled({data: data}); };
        document.getElementById('render-jquery').onclick = function () { $('#engine-output').empty().append($.tmpl('parent', data)); };
        document.getElementById('render-literal').onclick = function () {
            window.literalCalls = 0;
            document.getElementById('engine-output').innerHTML = literals.template(templates.literal, {read: function (value) {window.literalCalls++; return value.name;}});
        };
        document.getElementById('render-inline').onclick = function () {
            document.getElementById('engine-output').innerHTML = mageTemplate('#inline-source', {data: data});
            var native = document.createElement('div');
            native.appendChild(document.getElementById('native-source').content.cloneNode(true));
            ko.applyBindings({message: 'Native HTML'}, native);
            document.getElementById('engine-output').appendChild(native);
        };
        document.getElementById('ready').textContent = 'Ready';
    });
});
