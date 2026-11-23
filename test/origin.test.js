'use strict';

const test = require('node:test');
const assert = require('node:assert');
const origin = require('../peekaboo/lib/origin');

// headers, the setting, the answer expected and where it came from
const cases = [
    ['a proxy that says everything',
        { host: 'music.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'music.example.com' }, null,
        'https://music.example.com', 'proxy'],
    ['the Host header alone is http',
        { host: 'music.example.com' }, null,
        'http://music.example.com', 'host'],
    ['the Host header keeps its port',
        { host: 'music.example.com:8080' }, null,
        'http://music.example.com:8080', 'host'],
    ['a standard port is left out',
        { host: 'music.example.com:443', 'x-forwarded-proto': 'https' }, null,
        'https://music.example.com', 'host'],
    ['X-Forwarded-Port is added where the host has none',
        { host: 'player:3080', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'music.example.com', 'x-forwarded-port': '8443' }, null,
        'https://music.example.com:8443', 'proxy'],
    ['X-Forwarded-Port that is the standard one adds nothing',
        { host: 'music.example.com', 'x-forwarded-proto': 'https', 'x-forwarded-port': '443' }, null,
        'https://music.example.com', 'host'],
    ['the first of a chain of proxies counts',
        { host: 'inner', 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'music.example.com, inner.lan' }, null,
        'https://music.example.com', 'proxy'],
    ['Forwarded (RFC 7239)',
        { host: 'player:3080', forwarded: 'for=203.0.113.7;proto=https;host="music.example.com:8443", for=10.0.0.1' }, null,
        'https://music.example.com:8443', 'proxy'],
    ['X-Forwarded-Ssl',
        { host: 'music.example.com', 'x-forwarded-ssl': 'on' }, null,
        'https://music.example.com', 'host'],
    ['a scheme that is neither http nor https is not believed',
        { host: 'music.example.com', 'x-forwarded-proto': 'javascript' }, null,
        'http://music.example.com', 'host'],
    ['the page that asked gives the scheme the proxy left out',
        { host: 'music.example.com', referer: 'https://music.example.com/playback' }, null,
        'https://music.example.com', 'page'],
    ['the page that asked gives the port the proxy left out',
        { host: 'music.example.com', 'x-forwarded-proto': 'https', referer: 'https://music.example.com:8443/' }, null,
        'https://music.example.com:8443', 'page'],
    ['Origin counts before Referer',
        { host: 'music.example.com', origin: 'https://music.example.com', referer: 'http://music.example.com/' }, null,
        'https://music.example.com', 'page'],
    ['a page of another site is not told its own address',
        { host: 'music.example.com', 'x-forwarded-proto': 'https', origin: 'https://elsewhere.example.org' }, null,
        'https://music.example.com', 'host'],
    ['Origin: null is no address',
        { host: 'music.example.com', origin: 'null' }, null,
        'http://music.example.com', 'host'],
    ['host names compare without case or a final dot',
        { host: 'Music.Example.COM.', referer: 'https://music.example.com/' }, null,
        'https://music.example.com', 'page'],
    ['an IPv6 host',
        { host: '[fd00::5]:3080' }, null,
        'http://[fd00::5]:3080', 'host'],
    ['the setting wins over everything',
        { host: 'player:3080', 'x-forwarded-proto': 'http', 'x-forwarded-host': 'wrong.example.com', referer: 'http://player:3080/' },
        'https://music.example.com',
        'https://music.example.com', 'setting']
];

for (const [name, headers, setting, expected, from] of cases) {
    test('answer: ' + name, () => {
        assert.deepStrictEqual(origin.answer(headers, setting), { origin: expected, from: from });
    });
}

test('answer: no host at all is no answer', () => {
    assert.strictEqual(origin.answer({}, null), null);
    assert.strictEqual(origin.answer({ host: 'not a host' }, null), null);
    assert.strictEqual(origin.answer({ host: 'music.example.com:99999' }, null), null);
});

test('answer: a host that would break out of the JSON or the address is refused', () => {
    assert.strictEqual(origin.answer({ host: 'a"b' }, null), null);
    assert.strictEqual(origin.answer({ host: 'a/b' }, null), null);
    assert.strictEqual(origin.answer({ host: 'user@host' }, null), null);
});

test('configured: what the settings page takes', () => {
    assert.strictEqual(origin.configured('https://music.example.com'), 'https://music.example.com');
    assert.strictEqual(origin.configured(' https://Music.Example.com/ '), 'https://music.example.com');
    assert.strictEqual(origin.configured('https://music.example.com:443'), 'https://music.example.com');
    assert.strictEqual(origin.configured('http://music.example.com:8080'), 'http://music.example.com:8080');
});

test('configured: what it refuses', () => {
    for (const bad of ['', 'music.example.com', 'ftp://music.example.com', 'https://music.example.com/volumio',
        'https://music.example.com/?a=1', 'https://music.example.com/#x', 'https://user:pw@music.example.com', 'https://']) {
        assert.strictEqual(origin.configured(bad), null, bad);
    }
});
