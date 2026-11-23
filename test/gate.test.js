'use strict';

const test = require('node:test');
const assert = require('node:assert');
const gate = require('../peekaboo/lib/gate');

test('an empty list lets everyone in', () => {
    for (const empty of ['', '   ', null, undefined]) {
        const parsed = gate.parse(empty);
        assert.deepStrictEqual(parsed.bad, []);
        assert.strictEqual(gate.allows(parsed, '203.0.113.9'), true);
    }
    assert.strictEqual(gate.allows(null, '203.0.113.9'), true);
});

test('single addresses and networks, separated by commas or spaces', () => {
    const parsed = gate.parse('192.168.1.5, 10.0.0.0/8  fd00::/8;::1');
    assert.deepStrictEqual(parsed.bad, []);
    assert.deepStrictEqual(parsed.entries, ['192.168.1.5', '10.0.0.0/8', 'fd00::/8', '::1']);
    assert.strictEqual(gate.allows(parsed, '192.168.1.5'), true);
    assert.strictEqual(gate.allows(parsed, '192.168.1.6'), false);
    assert.strictEqual(gate.allows(parsed, '10.200.3.4'), true);
    assert.strictEqual(gate.allows(parsed, '11.0.0.1'), false);
    assert.strictEqual(gate.allows(parsed, 'fd12::1'), true);
    assert.strictEqual(gate.allows(parsed, 'fe80::1'), false);
    assert.strictEqual(gate.allows(parsed, '::1'), true);
});

test('an IPv4 address that came in over an IPv6 socket is itself', () => {
    const parsed = gate.parse('192.168.1.5');
    assert.strictEqual(gate.allows(parsed, '::ffff:192.168.1.5'), true);
    assert.strictEqual(gate.allows(parsed, '::ffff:192.168.1.6'), false);
    assert.strictEqual(gate.plain('::ffff:192.168.1.5'), '192.168.1.5');
    assert.strictEqual(gate.plain('fd00::1'), 'fd00::1');
});

test('what is not an address is named, and lets nobody in by mistake', () => {
    const parsed = gate.parse('192.168.1.5 proxy.lan 10.0.0.0/33 fd00::/129 1.2.3');
    assert.deepStrictEqual(parsed.bad, ['proxy.lan', '10.0.0.0/33', 'fd00::/129', '1.2.3']);
    assert.deepStrictEqual(parsed.entries, ['192.168.1.5']);
});

test('a list with entries refuses what is not an address', () => {
    const parsed = gate.parse('192.168.1.5');
    assert.strictEqual(gate.allows(parsed, undefined), false);
    assert.strictEqual(gate.allows(parsed, ''), false);
});
