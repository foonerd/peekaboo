'use strict';

// The plugin's own file with Volumio stood in for: switched on and off, its
// page, and what Save takes and refuses. Nothing here is handed on to a
// player; that is test/doorway.test.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const Module = require('node:module');

// The plugin's file needs two of Volumio's modules, which a player has and
// this test does not: promises by the little of kew the plugin uses, and the
// store by a table.
function wrap(promise) {
    return {
        then: (f, g) => wrap(promise.then(f, g)),
        fail: (f) => wrap(promise.catch(f)),
        native: promise
    };
}
const kew = {
    resolve: (value) => wrap(Promise.resolve(value)),
    reject: (error) => wrap(Promise.reject(error)),
    defer: () => {
        const d = {};
        d.promise = wrap(new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; }));
        return d;
    }
};
function Store() {
    this.kept = { port: 3080, public_address: '', allowed_from: '' };
    this.loadFile = () => { };
    this.get = (key) => this.kept[key];
    this.set = (key, value) => { this.kept[key] = value; };
}
const load = Module._load;
Module._load = function (request) {
    if (request === 'kew' || request === '/volumio/node_modules/kew') return kew;
    if (request === 'v-conf' || request === '/volumio/node_modules/v-conf') return Store;
    return load.apply(this, arguments);
};
// Left in place for the whole run: the plugin asks for its store when it
// starts, not when its file is read.
const Peekaboo = require('../peekaboo/index.js');

const plugin = path.join(__dirname, '..', 'peekaboo');
const strings = require('../peekaboo/i18n/strings_en.json').PEEKABOO;

// A port nobody has, for the length of a test.
function freePort() {
    return new Promise((resolve) => {
        const probe = net.createServer();
        probe.listen(0, () => {
            const port = probe.address().port;
            probe.close(() => resolve(port));
        });
    });
}

function ask(port, pathname, headers) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: port, path: pathname, headers: headers || {}, agent: false }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req.on('error', reject);
        req.end();
    });
}

// A plugin on a player that is stood in for; switched on at a free port.
async function switchedOn(t, kept) {
    const said = { toasts: [], pages: [] };
    const translate = (value) => {
        if (typeof value === 'string' && value.indexOf('TRANSLATE.PEEKABOO.') === 0) return strings[value.slice(19)];
        if (Array.isArray(value)) return value.map(translate);
        if (value && typeof value === 'object') {
            const out = {};
            Object.keys(value).forEach((k) => { out[k] = translate(value[k]); });
            return out;
        }
        return value;
    };
    let instance = null;
    const context = {
        coreCommand: {
            loadI18nStrings: () => { },
            getI18nString: (key) => (key.indexOf('PEEKABOO.') === 0 ? strings[key.slice(9)] : key),
            pushToastMessage: (type, title, message) => said.toasts.push({ type: type, title: title, message: message }),
            broadcastMessage: (name, message) => said.pages.push({ name: name, message: message }),
            getUIConfigOnPlugin: () => instance.getUIConfig(),
            i18nJson: (a, b, file) => kew.resolve(translate(JSON.parse(fs.readFileSync(file, 'utf8')))),
            sharedVars: { get: () => 'en' },
            pluginManager: { getConfigurationFile: () => '/dev/null' }
        },
        logger: { info: () => { }, error: () => { } },
        configManager: {}
    };
    instance = new Peekaboo(context);
    await instance.onVolumioStart().native;
    const port = await freePort();
    Object.assign(instance.config.kept, { port: port }, kept || {});
    await instance.onStart().native;
    t.after(() => instance.onStop().native);
    return { plugin: instance, port: port, said: said };
}

test('every key the page and the code name is in the English strings', () => {
    const page = fs.readFileSync(path.join(plugin, 'UIConfig.json'), 'utf8');
    const code = fs.readFileSync(path.join(plugin, 'index.js'), 'utf8');
    const named = (page.match(/TRANSLATE\.PEEKABOO\.([A-Z_]+)/g) || []).map((k) => k.slice(19))
        .concat((code.match(/text\('([A-Z_]+)'/g) || []).map((k) => k.slice(6, -1)));
    assert.ok(named.length > 10);
    for (const key of named) {
        assert.equal(typeof strings[key], 'string', key);
    }
    const used = new Set(named);
    for (const key of Object.keys(strings)) {
        assert.ok(used.has(key), key + ' is in the strings and nowhere else');
    }
});

test('switched on, it listens on its port and answers the page\'s question', async (t) => {
    const { plugin: p, port, said } = await switchedOn(t);
    const got = await ask(port, '/api/host', { Host: 'music.example.com', 'X-Forwarded-Proto': 'https' });
    assert.equal(got.status, 200);
    assert.deepEqual(JSON.parse(got.body), { host: 'https://music.example.com' });
    assert.deepEqual(said.toasts, []);
    assert.equal(p.failure, null);
});

test('its page says what it is doing and shows the settings as kept', async (t) => {
    const { plugin: p, port } = await switchedOn(t, { public_address: 'https://music.example.com', allowed_from: '127.0.0.1' });
    let page = await p.getUIConfig().native;
    assert.match(page.sections[0].description, new RegExp('^Listening on port ' + port + '\\. .*:' + port + ', WebSocket connections included\\. No page has asked through it yet\\.$'));
    assert.equal(page.sections[1].content[0].value, port);
    assert.equal(page.sections[1].content[1].value, 'https://music.example.com');
    assert.equal(page.sections[1].content[2].value, '127.0.0.1');
    assert.deepEqual(page.sections[1].saveButton.data, page.sections[1].content.map((c) => c.id));
    await ask(port, '/app/local-config.json', { Host: 'whatever' });
    page = await p.getUIConfig().native;
    assert.match(page.sections[0].description, /by way of 127\.0\.0\.1, was told the player is at https:\/\/music\.example\.com\.$/);
    assert.ok(!/\{\{/.test(JSON.stringify(page)), 'no hole is left unfilled');
});

test('a port that cannot be opened does not fail the plugin: it says so', async (t) => {
    const taken = net.createServer();
    await new Promise((resolve) => taken.listen(0, resolve));
    t.after(() => new Promise((resolve) => taken.close(resolve)));
    const { plugin: p, said } = await switchedOn(t, { port: taken.address().port });
    assert.match(p.failure, /EADDRINUSE/);
    assert.equal(said.toasts.length, 1);
    assert.equal(said.toasts[0].type, 'error');
    const page = await p.getUIConfig().native;
    assert.match(page.sections[0].description, /^Not listening: port \d+ could not be opened \(.*EADDRINUSE.*\)\. Choose another port below\.$/);
    // and Save with a port that can be had brings it up
    const port = await freePort();
    await p.saveSettings({ port: port, public_address: '', allowed_from: '' }).native;
    assert.equal(p.failure, null);
    assert.equal((await ask(port, '/api/host', { Host: 'a.example' })).status, 200);
});

test('Save keeps all three, moves the port, and tells the page', async (t) => {
    const { plugin: p, port, said } = await switchedOn(t);
    const next = await freePort();
    await p.saveSettings({ port: String(next), public_address: ' https://Music.Example.com/ ', allowed_from: '127.0.0.1 10.0.0.0/8' }).native;
    assert.deepEqual(p.config.kept, { port: next, public_address: 'https://music.example.com', allowed_from: '127.0.0.1, 10.0.0.0/8' });
    assert.deepEqual(said.toasts.map((x) => x.type), ['success']);
    assert.equal(said.toasts[0].message, 'Saved. Listening on port ' + next + '.');
    assert.deepEqual(JSON.parse((await ask(next, '/api/host', { Host: 'x' })).body), { host: 'https://music.example.com' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(ask(port, '/api/host'), { code: 'ECONNREFUSED' });
    assert.equal(said.pages.length, 1);
    assert.equal(said.pages[0].name, 'pushUiConfig');
});

test('Save refuses what is wrong, says what, and changes nothing', async (t) => {
    const { plugin: p, port, said } = await switchedOn(t);
    const before = JSON.stringify(p.config.kept);
    const wrong = [
        [{ port: '80', public_address: '', allowed_from: '' }, strings.BAD_PORT],
        [{ port: '3000', public_address: '', allowed_from: '' }, strings.BAD_PORT],
        [{ port: 'abc', public_address: '', allowed_from: '' }, strings.BAD_PORT],
        [{ port: '', public_address: '', allowed_from: '' }, strings.BAD_PORT],
        [{ port: '3080.5', public_address: '', allowed_from: '' }, strings.BAD_PORT],
        [{ port: port, public_address: 'music.example.com', allowed_from: '' }, strings.BAD_ADDRESS],
        [{ port: port, public_address: 'https://music.example.com/volumio', allowed_from: '' }, strings.BAD_ADDRESS],
        [{ port: port, public_address: '', allowed_from: '10.0.0.1, proxy.lan' }, 'Not an address or a network: proxy.lan. Nothing was changed.']
    ];
    for (const [data, message] of wrong) {
        said.toasts.length = 0;
        await p.saveSettings(data).native;
        assert.deepEqual(said.toasts, [{ type: 'error', title: 'Peekaboo', message: message }], JSON.stringify(data));
        assert.equal(JSON.stringify(p.config.kept), before);
    }
    assert.equal((await ask(port, '/api/host', { Host: 'a.example' })).status, 200);
});

test('Save with a port that is taken keeps the old port open', async (t) => {
    const { plugin: p, port, said } = await switchedOn(t);
    const taken = net.createServer();
    await new Promise((resolve) => taken.listen(0, resolve));
    t.after(() => new Promise((resolve) => taken.close(resolve)));
    await p.saveSettings({ port: taken.address().port, public_address: 'https://music.example.com', allowed_from: '' }).native;
    assert.equal(said.toasts.length, 1);
    assert.equal(said.toasts[0].type, 'error');
    assert.match(said.toasts[0].message, /^Port \d+ could not be opened \(.*\)\. Nothing was changed\.$/);
    assert.equal(p.config.kept.port, port);
    assert.equal(p.config.kept.public_address, '');
    assert.deepEqual(JSON.parse((await ask(port, '/api/host', { Host: 'a.example' })).body), { host: 'http://a.example' });
});

test('the proxy addresses take effect with Save', async (t) => {
    const { plugin: p, port } = await switchedOn(t);
    await p.saveSettings({ port: port, public_address: '', allowed_from: '192.0.2.1' }).native;
    assert.equal((await ask(port, '/api/host', { Host: 'a.example' })).status, 403);
    await p.saveSettings({ port: port, public_address: '', allowed_from: '' }).native;
    assert.equal((await ask(port, '/api/host', { Host: 'a.example' })).status, 200);
});

test('settings spoilt by hand do not stop it', async (t) => {
    const { plugin: p } = await switchedOn(t, { port: 'eighty', public_address: 'nonsense', allowed_from: 'nonsense' });
    assert.equal(p.settings().port, 3080);
    // 3080 may be in use on the machine the test runs on; either way it is on and says which
    assert.ok(p.failure === null || /EADDRINUSE/.test(p.failure));
});

test('switched off, the port is closed', async (t) => {
    const { plugin: p, port } = await switchedOn(t);
    await p.onStop().native;
    await assert.rejects(ask(port, '/api/host'), { code: 'ECONNREFUSED' });
    assert.equal(p.door, null);
});
