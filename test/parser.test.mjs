import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Exercise the real extension with SillyTavern imports replaced by host stubs.
const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/gm, '');

function setup(customSettings = {}) {
    const world = { entries: {} };
    const calls = { save: 0, chat: 0 };
    const context = vm.createContext({
        console: { log() {}, warn() {}, debug() {}, error() {} },
        extension_settings: { characterSaver: customSettings },
        eventSource: { on() {} },
        event_types: { APP_READY: 'ready', CHAT_CHANGED: 'chat', MESSAGE_RECEIVED: 'message' },
        chat: [], chat_metadata: { world: 'Test' }, METADATA_KEY: 'world',
        world_names: ['Test'],
        loadWorldInfo: async () => world,
        createWorldInfoEntry: () => {
            const uid = Object.keys(world.entries).length;
            return world.entries[uid] = { uid };
        },
        saveWorldInfo: async () => { calls.save++; },
        updateMessageBlock() {},
        saveChatConditional: async () => { calls.chat++; },
        updateWorldInfoList() {},
    });
    vm.runInContext(source, context);
    return { api: context.CharacterSaver, context, world, calls };
}

function wrap(content, update = false) {
    const kind = update ? 'update' : 'new';
    return `<!-- ${kind} character start\n${content}\n${kind} character end -->`;
}

for (const update of [false, true]) {
    const kind = update ? 'update' : 'character';
    const parse = (api, content) => update
        ? api.parseUpdateBlock(wrap(content, true))
        : api.parseCharacterBlock(wrap(content));
    const body = result => update ? result.content : result.description;

    for (const heading of ['Name: Alice', '**Name:** Alice', '**Name**: Alice', '**Alice**']) {
        test(`${kind}: legacy ${heading}`, () => {
            const { api } = setup();
            const content = `${heading}\nDescription.`;
            const result = parse(api, content);
            assert.equal(result.name, 'Alice');
            assert.equal(body(result), update ? content : 'Description.');
        });
    }

    for (const tag of ['npc', 'npc_update', 'NPC', 'NPC_UPDATE']) {
        for (const attrs of [
            'name="Alice"',
            "name='Alice' role='captain'",
            'role="captain" name="Alice" location="Harbor"',
            '\n role="captain"\n NAME \n = \n "Alice"\n',
            'note="rank > 2" name="Alice"',
            'name="Alice" note="rank > 2"',
            'note="name=\'Wrong\' > 2" data-name="Wrong" name="Alice"',
            'data-name="Wrong" surname="Wrong" name="Alice"',
            'name="  Alice  "',
        ]) {
            test(`${kind}: ${tag} ${attrs}`, () => {
                const { api } = setup();
                const content = `<${tag} ${attrs}>\n  Name: Wrong\n**Wrong**\n<nested>Text &amp; more</nested>\n</${tag}>`;
                const result = parse(api, content);
                assert.equal(result.name, 'Alice');
                assert.equal(body(result), content);
            });
        }
    }

    for (const attrs of ['role="captain"', 'name=""', "name='   '", 'data-name="Wrong"', 'surname="Wrong"', 'note="name=\'Wrong\'"']) {
        test(`${kind}: missing valid name: ${attrs}`, () => {
            const { api } = setup();
            const xml = `<npc ${attrs}>Description.</npc>`;
            assert.equal(parse(api, xml), null);
            const content = `${xml}\nName: Fallback`;
            const result = parse(api, content);
            assert.equal(result.name, 'Fallback');
            assert.equal(body(result), content);
        });
    }

    test(`${kind}: does not match similarly named tags`, () => {
        const { api } = setup();
        assert.equal(parse(api, '<npc_extra name="Wrong">Text</npc_extra>'), null);
    });
}

test('processing preserves XML for new entries and appended updates and removes triggered blocks', async () => {
    const { api, context, world, calls } = setup();
    const npc = '<npc role="captain" name="Alice">\n  **Wrong**\n  Description.\n</npc>';
    const second = '<npc name="Bob">Description.</npc>';
    const update = '<npc_update time="1" name="Alice">\n  Name: Wrong\n  Update.\n</npc_update>';
    const next = '<npc_update name="Alice" time="2">Another update.</npc_update>';
    context.chat.push({ mes: `Before\n${wrap(npc)}\n${wrap(second)}\n${wrap(update, true)}\nAfter` });
    await api.processMessage(0);
    await api.processUpdates(0);
    assert.equal(world.entries[0].key[0], 'Alice');
    assert.equal(world.entries[0].content, npc);
    assert.equal(world.entries[1].content, second);
    assert.equal(world.entries[2].comment, 'Update for Alice');
    assert.equal(world.entries[2].content, update);
    assert.equal(context.chat[0].mes, 'BeforeAfter');

    context.chat.push({ mes: wrap(next, true) });
    await api.processUpdates(1);
    assert.equal(world.entries[2].content, `${update}\n${next}`);
    assert.equal(Object.keys(world.entries).length, 3);
    assert.equal(context.chat[1].mes, '');
    assert.equal(calls.save, 4);
    assert.equal(calls.chat, 3);
});

test('standalone XML does not trigger detection, saving, or removal', async () => {
    const { api, context, calls } = setup();
    const content = '<npc name="Alice">Text</npc>\n<npc_update name="Alice">Update</npc_update>';
    assert.equal(api.detectCharacterBlocks(content).length, 0);
    assert.equal(api.detectUpdateBlocks(content).length, 0);
    context.chat.push({ mes: content });
    await api.processMessage(0);
    await api.processUpdates(0);
    assert.equal(context.chat[0].mes, content);
    assert.equal(calls.save, 0);
    assert.equal(calls.chat, 0);
});

test('custom delimiters still control detection and processing', async () => {
    const { api, context, world } = setup({
        startDelimiter: '[new]', endDelimiter: '[/new]',
        updateStartDelimiter: '[update]', updateEndDelimiter: '[/update]',
    });
    const npc = '<npc name="Alice">Text</npc>';
    const update = '<npc_update name="Alice">Update</npc_update>';
    const message = `[new]${npc}[/new][update]${update}[/update]`;
    assert.equal(api.detectCharacterBlocks(message).length, 1);
    assert.equal(api.detectUpdateBlocks(message).length, 1);
    assert.equal(api.detectCharacterBlocks(wrap(npc)).length, 0);
    context.chat.push({ mes: message });
    await api.processMessage(0);
    await api.processUpdates(0);
    assert.equal(world.entries[0].content, npc);
    assert.equal(world.entries[1].content, update);
    assert.equal(context.chat[0].mes, '');
});
