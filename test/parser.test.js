import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBlockRanges, extractName, parseBlock, removeRanges } from '../parser.js';

const creation = { start: '<!-- new character start', end: 'new character end -->' };
const updates = { start: '<!-- update character start', end: 'update character end -->' };

test('shared extraction preserves every legacy spelling result', () => {
    const expected = { name: 'John Doe', content: 'Description' };
    for (const source of ['Name: John Doe', '**Name:** John Doe', '**Name**: John Doe', '**John Doe**']) {
        assert.deepEqual(extractName(`${source}\nDescription`), expected);
        assert.deepEqual(parseBlock(`${creation.start}\n${source}\nDescription\n${creation.end}`, 'character', creation), {
            name: 'John Doe',
            description: 'Description',
        });
    }
});

test('creation tag accepts rich attributes, whitespace, case, entities and punctuation', () => {
    const block = `<NPC role='lead'\n NAME \n = \n "  Zoë O&apos;Neil &amp; 李  " data-id='7'>\nA detective.\n</nPc>`;
    assert.deepEqual(parseBlock(block, 'character', creation), {
        name: "Zoë O'Neil & 李",
        description: block,
    });
});

test('update name and timestamp attributes remain in retained paired tags', () => {
    for (const block of [
        `<npc_update timestamp='2024-07-07T08:39' name="John Doe">Promoted.</npc_update>`,
        `<NPC_UPDATE NAME='John Doe' extra="yes" TIMESTAMP = "2024-07-07T08:39">Promoted.</NPC_UPDATE>`,
    ]) {
        assert.deepEqual(parseBlock(block, 'update', updates), {
            name: 'John Doe',
            content: block,
        });
    }
});

test('tags inside legacy blocks are retained while delimiters are removed', () => {
    const character = `${creation.start}\n<npc name="Ada Lovelace">\nMathematician\n${creation.end}`;
    const update = `${updates.start}\n<npc_update name="Ada Lovelace">\nLearned something.\n${updates.end}`;
    assert.equal(parseBlock(character, 'character', creation).description, '<npc name="Ada Lovelace">\nMathematician');
    assert.equal(parseBlock(update, 'update', updates).content, '<npc_update name="Ada Lovelace">\nLearned something.');
});

test('paired and self-closing standalone tags are detected in mixed messages', () => {
    const legacy = `${creation.start}\nName: Legacy Person\nOld format\n${creation.end}`;
    const message = `before\n${legacy}\nmiddle\n<npc name='Pair Person'>Paired</npc>\n<npc name="Solo Person" />\nafter`;
    const ranges = detectBlockRanges(message, 'character', creation);
    assert.equal(ranges.length, 3);
    assert.deepEqual(ranges.map(range => parseBlock(range.text, 'character', creation).name),
        ['Legacy Person', 'Pair Person', 'Solo Person']);
    assert.equal(parseBlock(ranges[1].text, 'character', creation).description, "<npc name='Pair Person'>Paired</npc>");
    assert.equal(parseBlock(ranges[2].text, 'character', creation).description, '<npc name="Solo Person" />');
    assert.equal(removeRanges(message, ranges), 'before\n\nmiddle\n\n\nafter');
});

test('malformed/unclosed tags are not detected and absent or empty names do not parse', () => {
    const message = `keep <npc name="Unclosed"> narrative\nkeep <npc_name name="Wrong" />\nkeep <npc name=NoQuotes />`;
    assert.equal(detectBlockRanges(message, 'character', creation).length, 0);
    for (const value of ['<npc />', '<npc name="  " />', '<npc surname="Smith" />', '<npc displayname="Jane" />']) {
        assert.equal(parseBlock(value, 'character', creation), null);
    }
});

test('an unclosed tag cannot consume a later valid element', () => {
    const message = `<npc name="Unclosed"> narrative\n<npc name="Valid">description</npc>`;
    const ranges = detectBlockRanges(message, 'character', creation);
    assert.equal(ranges.length, 1);
    assert.equal(parseBlock(ranges[0].text, 'character', creation).name, 'Valid');
});

test('multiple mixed update blocks retain meaningful content', () => {
    const legacy = `${updates.start}\n**Name:** Renée Smith-Jones\nChanged roles.\n${updates.end}`;
    const message = `${legacy}\n<npc_update name='李 雷'>Moved.</npc_update>\n<npc_update timestamp='noon' name='Self Close' />`;
    const parsed = detectBlockRanges(message, 'update', updates).map(range => parseBlock(range.text, 'update', updates));
    assert.deepEqual(parsed, [
        { name: 'Renée Smith-Jones', content: 'Changed roles.' },
        { name: '李 雷', content: "<npc_update name='李 雷'>Moved.</npc_update>" },
        { name: 'Self Close', content: "<npc_update timestamp='noon' name='Self Close' />" },
    ]);
});

test('only selected exact source spans are removed', () => {
    const message = `<npc name="Good">ok</npc> between <npc>missing name</npc>`;
    const ranges = detectBlockRanges(message, 'character', creation);
    assert.equal(ranges.length, 2);
    const valid = ranges.filter(range => parseBlock(range.text, 'character', creation));
    assert.equal(removeRanges(message, valid), 'between <npc>missing name</npc>');
});
