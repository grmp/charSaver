import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBlockRanges, parseBlock, removeLegacyRanges } from '../parser.js';

const creation = { start: '<!-- new character start', end: 'new character end -->' };
const updates = { start: '<!-- update character start', end: 'update character end -->' };

test('creation tags support attribute order, quote styles, multiline spacing, case, and extras', () => {
    const blocks = [
        `<NPC role='lead'\n data-name="wrong" NAME \n = \n "Zoë &amp; 李" note='a > b & c'>\nBio\n</nPc>`,
        `<npc timestamp="2024-07-07T08:39" name='Jane Doe' enabled="yes">Bio</npc>`,
    ];
    assert.deepEqual(parseBlock(blocks[0], 'character', creation), {
        name: 'Zoë & 李', description: blocks[0],
    });
    assert.deepEqual(parseBlock(blocks[1], 'character', creation), {
        name: 'Jane Doe', description: blocks[1],
    });
});

test('update tags preserve the exact complete element as stored content', () => {
    const block = `<NPC_UPDATE timestamp="2024-07-07T08:39" data-note='x & y' name = 'John Doe'>\r\nPromoted.\r\n</NPC_UPDATE>`;
    assert.deepEqual(parseBlock(block, 'update', updates), { name: 'John Doe', content: block });
});

test('mixed legacy and tag blocks retain source order without duplicates', () => {
    const old = `${creation.start}\nName: Legacy Person\nOld format\n${creation.end}`;
    const first = `<npc name='First'>One</npc>`;
    const second = `<NPC NAME="Second">Two</NPC>`;
    const message = `before ${first}\n${old}\n${second} after`;
    const ranges = detectBlockRanges(message, 'character', creation);
    assert.deepEqual(ranges.map(range => parseBlock(range.text, 'character', creation).name),
        ['First', 'Legacy Person', 'Second']);
    assert.equal(new Set(ranges.map(range => `${range.start}:${range.end}`)).size, 3);
});

test('missing, empty, lookalike, malformed, mismatched, and unrelated tags are ignored', () => {
    const invalid = [
        '<npc>Missing</npc>', '<npc name=" ">Empty</npc>',
        '<npc data-name="Wrong">Lookalike</npc>', '<npc surname="Wrong">Lookalike</npc>',
        '<npc name=Unquoted>Bad</npc>', '<npc name="Open">No close',
        '<npc name="Wrong close">Bad</npc_update>', '<person name="Other">No</person>',
        '<npc name="Self closing" />',
    ];
    for (const value of invalid) {
        assert.equal(detectBlockRanges(value, 'character', creation).length, 0, value);
        assert.equal(parseBlock(value, 'character', creation), null, value);
    }
});

test('an unclosed tag cannot consume a later valid element', () => {
    const valid = `<npc name="Valid">description</npc>`;
    const ranges = detectBlockRanges(`<npc name="Unclosed"> narrative\n${valid}`, 'character', creation);
    assert.deepEqual(ranges.map(range => range.text), [valid]);
});

test('legacy delimiter parsing and removal remain compatible', () => {
    const block = `${updates.start}\n**Name:** Renée Smith-Jones\nChanged roles.\n${updates.end}`;
    assert.deepEqual(parseBlock(block, 'update', updates), {
        name: 'Renée Smith-Jones', content: '**Name:** Renée Smith-Jones\nChanged roles.',
    });
    const range = detectBlockRanges(`before\n${block}\nafter`, 'update', updates)[0];
    assert.equal(removeLegacyRanges(`before\n${block}\nafter`, [range]), 'before\n\nafter');
});

test('processing removal keeps tag bytes while removing successful legacy ranges only', () => {
    const tag = `<npc_update\n timestamp="2024-07-07T08:39"\n name='A &amp; B'>\r\nExact body\r\n</npc_update>`;
    const legacy = `${updates.start}\nName: Legacy\nChanged\n${updates.end}`;
    const source = `prefix\n${tag}\n${legacy}\nsuffix`;
    const successful = detectBlockRanges(source, 'update', updates)
        .filter(range => parseBlock(range.text, 'update', updates));
    const processed = removeLegacyRanges(source, successful);
    assert.equal(processed, `prefix\n${tag}\n\nsuffix`);
    assert.ok(processed.includes(tag));
});

test('tag nested inside a legacy range is not returned twice', () => {
    const tag = '<npc name="Inner">Bio</npc>';
    const source = `${creation.start}\nName: Outer\n${tag}\n${creation.end}`;
    const ranges = detectBlockRanges(source, 'character', creation);
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].syntax, 'legacy');
});
