import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

// Exercise the real extension with SillyTavern imports replaced by host stubs.
const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
    .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\s*/gm, '');

function setup(customSettings = {}, initialWorlds = {}) {
    const world = { entries: {} };
    const worlds = { Test: world, ...initialWorlds };
    const calls = { save: 0, chat: 0, settings: 0 };
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: '', checked: false, listeners: {},
            addEventListener(type, handler) { this.listeners[type] = handler; } });
        return elements.get(id);
    };
    const context = vm.createContext({
        structuredClone,
        document: { querySelector: element, getElementById: element },
        saveSettingsDebounced() { calls.settings++; },
        console: { log() {}, warn() {}, debug() {}, error() {} },
        extension_settings: { characterSaver: customSettings },
        eventSource: { on() {} },
        event_types: { APP_READY: 'ready', CHAT_CHANGED: 'chat', MESSAGE_RECEIVED: 'message' },
        chat: [], chat_metadata: { world: 'Test' }, METADATA_KEY: 'world',
        world_names: ['Test'],
        loadWorldInfo: async name => worlds[name] || (worlds[name] = { entries: {} }),
        createWorldInfoEntry: (name, data) => {
            const uid = Math.max(-1, ...Object.keys(data.entries).map(Number)) + 1;
            return data.entries[uid] = { uid };
        },
        saveWorldInfo: async (name, data) => { calls.save++; worlds[name].entries = structuredClone(data.entries); },
        updateMessageBlock() {},
        saveChatConditional: async () => { calls.chat++; },
        updateWorldInfoList() {},
    });
    vm.runInContext(source, context);
    return { api: context.CharacterSaver, context, world: worlds.Test, worlds, calls, element };
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

async function toggleSeparate(env, checked) {
    await vm.runInContext('renderSettings()', env.context);
    const checkbox = env.element('char_saver_separate_update_entries');
    checkbox.checked = checked;
    checkbox.listeners.change();
}

test('settings checkbox defaults off, persists immediately, and restores on render and reload', async () => {
    const env = setup();
    await vm.runInContext('renderSettings()', env.context);
    assert.equal(env.element('char_saver_separate_update_entries').checked, false);
    await toggleSeparate(env, true);
    assert.equal(env.calls.settings, 1);
    assert.equal(env.context.extension_settings.characterSaver.separateUpdateEntries, true);
    const reloaded = setup(structuredClone(env.context.extension_settings.characterSaver));
    await vm.runInContext('renderSettings()', reloaded.context);
    assert.equal(reloaded.element('char_saver_separate_update_entries').checked, true);
});

test('separate mode creates one entry per block with independent character counters', async () => {
    const env = setup({ separateUpdateEntries: true });
    const updates = ['Name: Alice\nFirst.', 'Name: Alice\nSecond.', 'Name: Bob\nFirst.'];
    env.context.chat.push({ mes: updates.map(text => wrap(text, true)).join('\n') });
    await env.api.processUpdates(0);
    const entries = Object.values(env.world.entries);
    assert.deepEqual(entries.map(entry => entry.comment), ['Update #1 for Alice', 'Update #2 for Alice', 'Update #1 for Bob']);
    assert.deepEqual(entries.map(entry => entry.content), updates);
    for (const entry of entries) {
        assert.equal(entry.constant, false);
        assert.equal(entry.vectorized, true);
        assert.equal(entry.order, 100);
        assert.equal(entry.depth, 4);
        assert.equal(entry.probability, 100);
        assert.equal(entry.position, 0);
        assert.equal(entry.selective, false);
        assert.equal(entry.keysecondary.length, 0);
    }
    assert.equal(entries[0].key[0], 'Alice');
    assert.equal(env.context.chat[0].mes, '');
    assert.equal(env.calls.save, 3);
});

test('concurrent writes use fresh lorebook data and separate lorebook counters', async () => {
    const env = setup({ separateUpdateEntries: true });
    env.context.chat.push({ mes: wrap('Name: Carol\nDescription.') });
    await Promise.all([
        env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'One'),
        env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Two'),
        env.api.createOrUpdateLorebookEntry('Other', 'Alice', 'Other'),
        env.api.processMessage(0),
    ]);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment),
        ['Update #1 for Alice', 'Update #2 for Alice', 'Character: Carol']);
    assert.equal(env.worlds.Other.entries[0].comment, 'Update #1 for Alice');
});

test('mode changes preserve entries and resume counters after deletion and restart', async () => {
    const env = setup();
    await env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Legacy');
    await toggleSeparate(env, true);
    await env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'One');
    await env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Two');
    delete env.world.entries[2];
    const restarted = setup(structuredClone(env.context.extension_settings.characterSaver), structuredClone(env.worlds));
    await toggleSeparate(restarted, false);
    await restarted.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Appended');
    assert.equal(restarted.world.entries[0].content, 'Legacy\nAppended');
    assert.equal(restarted.world.entries[1].content, 'One');
    await toggleSeparate(restarted, true);
    await restarted.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Three');
    assert.equal(restarted.world.entries[2].comment, 'Update #3 for Alice');
    assert.equal(restarted.world.entries[2].content, 'Three');
});

test('number selection uses exact names and maximum saved or existing number', async () => {
    const name = 'A.* [test]';
    const env = setup({ separateUpdateEntries: true, updateEntryCounters: [
        { worldName: 'Test', characterName: name, lastNumber: 5 },
    ] });
    for (const [i, comment] of ['Update #8 for A.* [test]', 'Update #99 for A.* [test] extra',
        'Update #80 for a.* [test]', 'Update for A.* [test]', 'Update #invalid for A.* [test]'].entries()) {
        env.world.entries[i] = { uid: i, comment };
    }
    await env.api.createOrUpdateLorebookEntry('Test', name, 'Nine');
    assert.equal(env.world.entries[5].comment, 'Update #9 for A.* [test]');
    env.world.entries = {};
    await env.api.createOrUpdateLorebookEntry('Test', name, 'Ten');
    assert.equal(env.world.entries[0].comment, 'Update #10 for A.* [test]');
});

for (const failure of ['load missing', 'load throws', 'save throws']) {
    test(`${failure}: reports failure without advancing counters or changing persisted entries`, async () => {
        const env = setup({ separateUpdateEntries: true });
        const load = env.context.loadWorldInfo;
        const save = env.context.saveWorldInfo;
        if (failure === 'load missing') env.context.loadWorldInfo = async () => null;
        if (failure === 'load throws') env.context.loadWorldInfo = async () => { throw new Error('load'); };
        if (failure === 'save throws') env.context.saveWorldInfo = async () => { throw new Error('save'); };
        assert.equal(await env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Failed'), false);
        assert.equal(env.calls.settings, 0);
        assert.equal(Object.keys(env.world.entries).length, 0);
        env.context.chat.push({ mes: wrap('Name: Alice\nFailed', true) });
        const original = env.context.chat[0].mes;
        await env.api.processUpdates(0);
        assert.equal(env.context.chat[0].mes, original);
        assert.equal(env.calls.chat, 0);
        env.context.loadWorldInfo = load;
        env.context.saveWorldInfo = save;
        assert.equal(await env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Retry'), true);
        assert.equal(env.world.entries[0].comment, 'Update #1 for Alice');
    });
}
