'use strict';

// Who may come in: the addresses the settings page names, each a single
// address or a network in CIDR form (192.168.1.5, 192.168.1.0/24, fd00::/8),
// separated by commas or spaces. An empty list lets everyone in, as the
// player's own page does.

var net = require('net');

// An IPv4 address that reached a socket listening for both families.
function plain(address) {
    var text = String(address || '');
    var m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(text);
    return m ? m[1] : text;
}

// { list, entries, bad }: the list to ask, the entries as they were
// understood, and the ones that could not be.
function parse(text) {
    var list = new net.BlockList();
    var entries = [];
    var bad = [];
    String(text || '').split(/[\s,;]+/).forEach(function (entry) {
        if (entry === '') return;
        var at = entry.indexOf('/');
        var address = plain(at < 0 ? entry : entry.slice(0, at));
        var family = net.isIP(address);
        if (!family) {
            bad.push(entry);
            return;
        }
        var kind = family === 4 ? 'ipv4' : 'ipv6';
        if (at < 0) {
            list.addAddress(address, kind);
            entries.push(address);
            return;
        }
        var bits = entry.slice(at + 1);
        var most = family === 4 ? 32 : 128;
        if (!/^\d{1,3}$/.test(bits) || Number(bits) > most) {
            bad.push(entry);
            return;
        }
        list.addSubnet(address, Number(bits), kind);
        entries.push(address + '/' + Number(bits));
    });
    return { list: list, entries: entries, bad: bad };
}

// Whether an address a connection came from is let in by a parsed list.
function allows(parsed, address) {
    if (!parsed || parsed.entries.length === 0) return true;
    var from = plain(address);
    var family = net.isIP(from);
    if (!family) return false;
    return parsed.list.check(from, family === 4 ? 'ipv4' : 'ipv6');
}

module.exports = {
    parse: parse,
    allows: allows,
    plain: plain
};
