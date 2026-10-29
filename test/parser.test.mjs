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
    const calls = { save: 0, chat: 0, settings: 0, metadata: 0, create: 0, delete: 0 };
    const handlers = {};
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { value: '', checked: false, listeners: {},
            classList: { toggle() {} },
            addEventListener(type, handler) { this.listeners[type] = handler; } });
        return elements.get(id);
    };
    const context = vm.createContext({
        structuredClone,
        document: { querySelector: element, getElementById: element },
        saveSettingsDebounced() { calls.settings++; },
        console: { log() {}, warn() {}, debug() {}, error() {} },
        extension_settings: { characterSaver: customSettings },
        eventSource: { on(type, handler) { handlers[type] = handler; } },
        event_types: { APP_READY: 'ready', CHAT_CHANGED: 'chat', MESSAGE_RECEIVED: 'message' },
        chat: [], chat_metadata: { characterSaverWorld: 'Test', world_info: 'Test' }, METADATA_KEY: 'world_info', name2: 'Hero',
        characters: [{ name: 'Hero', avatar: 'Hero.png' }], this_chid: 0,
        world_names: ['Test'],
        loadWorldInfo: async name => worlds[name] || (worlds[name] = { entries: {} }),
        createWorldInfoEntry: (name, data) => {
            const uid = Math.max(-1, ...Object.keys(data.entries).map(Number)) + 1;
            return data.entries[uid] = { uid };
        },
        saveWorldInfo: async (name, data) => { calls.save++; worlds[name].entries = structuredClone(data.entries); },
        createNewWorldInfo: async name => {
            // Native creation returns false for case/accent-insensitive name
            // collisions, rather than throwing or overwriting an existing book.
            if (context.world_names.some(existing => existing.localeCompare(name, undefined, { sensitivity: 'base' }) === 0)) return false;
            calls.create++;
            worlds[name] = { entries: {} };
            context.world_names.push(name);
            await context.updateWorldInfoList();
            return true;
        },
        deleteWorldInfo: async name => {
            calls.delete++;
            delete worlds[name];
            context.world_names = context.world_names.filter(existing => existing !== name);
            return true;
        },
        updateMessageBlock() {},
        saveMetadata: async () => { calls.metadata++; },
        saveChatConditional: async () => { calls.chat++; },
        updateWorldInfoList() {},
    });
    vm.runInContext(source, context);
    return { api: context.CharacterSaver, context, world: worlds.Test, worlds, calls, element, handlers };
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
    assert.equal(world.entries[1].comment, 'All NPC');
    assert.equal(world.entries[1].order, 98);
    assert.equal(world.entries[1].constant, true);
    assert.equal(world.entries[1].vectorized, false);
    assert.equal(world.entries[1].content, 'Known NPC=\nrole=captain, name=Alice\nname=Bob');
    assert.equal(world.entries[2].content, second);
    assert.equal(world.entries[3].comment, 'Update for Alice');
    assert.equal(world.entries[3].content, update);
    assert.equal(context.chat[0].mes, 'BeforeAfter');

    context.chat.push({ mes: wrap(next, true) });
    await api.processUpdates(1);
    assert.equal(world.entries[3].content, `${update}\n${next}`);
    assert.equal(world.entries[1].content, 'Known NPC=\nrole=captain, name=Alice\nname=Bob');
    assert.equal(Object.keys(world.entries).length, 4);
    assert.equal(context.chat[1].mes, '');
    assert.equal(calls.save, 4);
    assert.equal(calls.chat, 3);
});

test('All NPC appends every opening-tag attribute and preserves existing entry settings', async () => {
    const { api, context, world, calls } = setup({}, { Test: { entries: {
        0: { uid: 0, comment: 'All NPC', content: 'name=Existing', constant: true, key: ['custom'] },
    } } });
    context.chat.push({ mes: wrap('<npc name="Test" color="#fffff" sex="male">Text</npc>') });
    context.chat.push({ mes: wrap(`<NPC\n role='captain' NAME = "Other" empty="" note="rank > 2; name='Wrong'" data-id="42"/>`) });
    await Promise.all([api.processMessage(0), api.processMessage(1)]);
    assert.equal(world.entries[0].content,
        "Known NPC=\nname=Existing\nname=Test, color=#fffff, sex=male\nrole=captain, NAME=Other, empty=, note=rank > 2; name='Wrong', data-id=42");
    assert.equal(world.entries[0].constant, true);
    assert.deepEqual(world.entries[0].key, ['custom']);
    assert.equal(Object.values(world.entries).filter(entry => entry.comment === 'All NPC').length, 1);
    assert.equal(calls.save, 2);
});

for (const heading of ['Name: Alice', '**Name:** Alice', '**Name**: Alice', '**Alice**']) {
    test(`legacy introduction ${heading} appends only its name to All NPC`, async () => {
        const { api, context, world } = setup();
        const description = 'Description.\nColor: #fffff\nSex: female';
        context.chat.push({ mes: wrap(`${heading}\n${description}`) });
        await api.processMessage(0);
        assert.equal(world.entries[1].content, 'Known NPC=\nname=Alice');
        assert.equal(world.entries[0].content, description);
    });
}

test('failed character save preserves message and registry for retry', async () => {
    const { api, context, world } = setup();
    const original = wrap('<npc name="Test" color="#fffff" sex="male"/>');
    context.chat.push({ mes: original });
    const save = context.saveWorldInfo;
    context.saveWorldInfo = async () => { throw new Error('save'); };
    await api.processMessage(0);
    assert.equal(context.chat[0].mes, original);
    assert.equal(Object.keys(world.entries).length, 0);
    context.saveWorldInfo = save;
    await api.processMessage(0);
    assert.equal(world.entries[1].content, 'Known NPC=\nname=Test, color=#fffff, sex=male');
    assert.equal(context.chat[0].mes, '');
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
    assert.equal(world.entries[2].content, update);
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
    assert.deepEqual(entries.map(entry => entry.comment), ['Update Alice #1', 'Update Alice #2', 'Update Bob #1']);
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
        ['Update Alice #1', 'Update Alice #2', 'Character: Carol', 'All NPC']);
    assert.equal(env.worlds.Other.entries[0].comment, 'Update Alice #1');
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
    assert.equal(restarted.world.entries[2].comment, 'Update Alice #3');
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
    assert.equal(env.world.entries[5].comment, 'Update A.* [test] #9');
    env.world.entries = {};
    await env.api.createOrUpdateLorebookEntry('Test', name, 'Ten');
    assert.equal(env.world.entries[0].comment, 'Update A.* [test] #10');
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
        assert.equal(env.world.entries[0].comment, 'Update Alice #1');
    });
}

for (const update of [false, true]) {
    for (const opener of ['', '<!-- ', '<!--\n  ']) {
        test(`closing marker: update=${update}, opener=${JSON.stringify(opener)}`, async () => {
            const env = setup({ separateUpdateEntries: true });
            const kind = update ? 'update' : 'new';
            const tag = update ? 'npc_update' : 'npc';
            const content = `<${tag} name="Solene" timestamp="2024-07-08T12:19">\n<!-- Keep this comment. -->\n- Status update= Bound to Nick's voice-anchor.\n</${tag}>`;
            const block = `<!-- ${kind} character start\n${content}\n${opener}${kind} character end -->`;
            const parse = update ? env.api.parseUpdateBlock : env.api.parseCharacterBlock;
            const parsed = parse(block);
            assert.equal(update ? parsed.content : parsed.description, content);
            env.context.chat.push({ mes: `Before\n${block}\nAfter` });
            await (update ? env.api.processUpdates(0) : env.api.processMessage(0));
            const entry = Object.values(env.world.entries).find(e => e.key?.[0] === 'Solene');
            assert.equal(entry.content, content);
            assert.equal(env.context.chat[0].mes, 'BeforeAfter');
        });
    }
}

test('closing comment cleanup supports append mode and explicit comment delimiters', async () => {
    const env = setup({ updateEndDelimiter: '<!-- update character end -->' });
    const content = '<npc_update name="Solene">Update.</npc_update>';
    const block = `<!-- update character start\n${content}\n<!-- update character end -->`;
    for (let i = 0; i < 2; i++) {
        env.context.chat.push({ mes: block });
        await env.api.processUpdates(i);
    }
    // The identical block is stored only once; a different block still appends.
    assert.equal(env.world.entries[0].content, content);
    const other = '<npc_update name="Solene">Different update.</npc_update>';
    env.context.chat.push({ mes: `<!-- update character start\n${other}\n<!-- update character end -->` });
    await env.api.processUpdates(2);
    assert.equal(env.world.entries[0].content, `${content}\n${other}`);
});

test('custom non-comment delimiters preserve trailing comment openers and inner delimiter text', () => {
    const env = setup({ updateStartDelimiter: '[update]', updateEndDelimiter: '[/update]' });
    const content = '<npc_update name="Solene">Literal [update] text.</npc_update>\n<!--';
    assert.equal(env.api.parseUpdateBlock(`[update]${content}[/update]`).content, content);
});

for (const separateUpdateEntries of [false, true]) {
    test(`multiple NPC updates in one wrapper, separate=${separateUpdateEntries}`, async () => {
        const env = setup({ separateUpdateEntries });
        const names = ['Stella', 'Tamsin', 'Seraphine', 'Pip', 'Solene', 'Liora', 'Liris'];
        const parts = names.map((name, i) => `<npc_update name="${name}" timestamp="2024-07-08T12:29">\n- Status= Assigned task ${i}.\n  </npc_update>`);
        env.context.chat.push({ mes: `Before\n${wrap(parts.join('\n  '), true)}\nAfter` });
        await env.api.processUpdates(0);
        const entries = Object.values(env.world.entries);
        assert.equal(entries.length, 7);
        assert.deepEqual(entries.map(e => e.key[0]), names);
        assert.deepEqual(entries.map(e => e.content), parts);
        assert.deepEqual(entries.map(e => e.comment), names.map(name => separateUpdateEntries ? `Update ${name} #1` : `Update for ${name}`));
        assert.equal(env.context.chat[0].mes, 'BeforeAfter');
    });
}

test('siblings support custom delimiters, mixed tag case, quoted angles and repeated names', async () => {
    const env = setup({ separateUpdateEntries: true, updateStartDelimiter: '[updates]', updateEndDelimiter: '[/updates]' });
    const parts = ['<NPC_UPDATE note="rank > 2" name="Alice"><detail>First</detail></NPC_UPDATE>',
        "<npc name='Alice'>Second <!-- <npc_update name=\"Ignored\"> --> </npc>"];
    env.context.chat.push({ mes: `[updates]${parts.join('\n')}[/updates]` });
    await env.api.processUpdates(0);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.content), parts);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment), ['Update Alice #1', 'Update Alice #2']);
});

test('partial failure keeps only unsaved siblings for retry and preserves other failed blocks', async () => {
    const env = setup({ separateUpdateEntries: true });
    const save = env.context.saveWorldInfo;
    env.context.saveWorldInfo = async (name, data) => {
        if (Object.values(data.entries).some(e => e.key[0] === 'Bob')) throw new Error('save failed');
        await save(name, data);
    };
    const alice = '<npc_update name="Alice">First.</npc_update>';
    const bob = '<npc_update name="Bob">Second.</npc_update>';
    const invalid = wrap('No identifiable character.', true);
    env.context.chat.push({ mes: `${wrap(alice + '\n' + bob, true)}\n${invalid}` });
    await env.api.processUpdates(0);
    assert.equal(Object.keys(env.world.entries).length, 1);
    assert.ok(!env.context.chat[0].mes.includes(alice));
    assert.ok(env.context.chat[0].mes.includes(bob));
    assert.ok(env.context.chat[0].mes.includes(invalid));
    env.context.saveWorldInfo = save;
    await env.api.processUpdates(0);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment), ['Update Alice #1', 'Update Bob #1']);
    assert.equal(env.context.chat[0].mes, invalid);
});

for (const content of [
    '<npc_update name="Alice">One.</npc_update><npc_update name="Bob">Unclosed',
    '<npc_update name="Alice">One.<npc_update name="Bob">Nested.</npc_update></npc_update>',
    '<npc_update name="Alice">One.</npc_update>Unassigned text<npc_update name="Bob">Two.</npc_update>',
]) {
    test(`ambiguous sibling group remains unchanged: ${content}`, async () => {
        const env = setup();
        const original = wrap(content, true);
        env.context.chat.push({ mes: original });
        await env.api.processUpdates(0);
        assert.equal(env.calls.save, 0);
        assert.equal(env.context.chat[0].mes, original);
    });
}

test('numbering continues from both title formats and matches the entire character name', async () => {
    const env = setup({ separateUpdateEntries: true });
    const name = 'Alice #2';
    const comments = ['Update #7 for Alice #2', 'Update Alice #2 #9',
        'Update Alice #2 extra #80', 'Update alice #2 #90', 'Update Alice #99'];
    comments.forEach((comment, uid) => { env.world.entries[uid] = { uid, comment }; });
    await env.api.createOrUpdateLorebookEntry('Test', name, 'Next');
    assert.equal(env.world.entries[5].comment, 'Update Alice #2 #10');
    assert.deepEqual(Object.values(env.world.entries).slice(0, 5).map(e => e.comment), comments);
});

test('outer delimiters determine creation or update regardless of the NPC tag', async () => {
    const env = setup({ separateUpdateEntries: true });
    const content = '<npc_update name="Alice">Status changed.</npc_update>';
    env.context.chat.push({ mes: wrap(content) });
    await env.api.processMessage(0);
    await env.api.processUpdates(0);
    assert.equal(env.world.entries[0].comment, 'Character: Alice');
    env.context.chat.push({ mes: wrap(content, true) });
    await env.api.processMessage(1);
    await env.api.processUpdates(1);
    assert.ok(Object.values(env.world.entries).some(e => e.comment === 'Update Alice #1'));
    assert.equal(Object.values(env.world.entries).filter(e => e.comment === 'Character: Alice').length, 1);
});

test('pause for this chat persists to chat metadata, renders, and blocks processing', async () => {
    const env = setup();
    assert.equal(env.api.isPausedForChat(), false);
    await vm.runInContext('renderSettings()', env.context);
    const checkbox = env.element('char_saver_paused_for_chat');
    assert.equal(checkbox.checked, false);
    checkbox.checked = true;
    checkbox.listeners.change();
    assert.equal(env.api.isPausedForChat(), true);
    assert.equal(env.context.chat_metadata.characterSaverPaused, true);
    assert.equal(env.calls.metadata, 1);
    await vm.runInContext('renderSettings()', env.context);
    assert.equal(env.element('char_saver_paused_for_chat').checked, true);
    const message = wrap('<npc name="Alice">Text</npc>');
    env.context.chat.push({ mes: message });
    await env.api.processMessage(0);
    await env.api.processUpdates(0);
    assert.equal(Object.keys(env.world.entries).length, 0);
    assert.equal(env.calls.save, 0);
    assert.equal(env.context.chat[0].mes, message);
    checkbox.checked = false;
    checkbox.listeners.change();
    assert.equal(env.api.isPausedForChat(), false);
    assert.equal('characterSaverPaused' in env.context.chat_metadata, false);
    await env.api.processMessage(0);
    assert.ok(Object.values(env.world.entries).some(e => e.comment === 'Character: Alice'));
});

function deferred() {
    let resolve;
    const promise = new Promise(accept => { resolve = accept; });
    return { promise, resolve };
}

for (const initiallyPaused of [false, true]) {
    test(`hidden settings reflect the new chat's pause state, initiallyPaused=${initiallyPaused}`, async () => {
        const env = setup();
        if (initiallyPaused) env.api.setPausedForChat(true);
        await vm.runInContext('renderSettings()', env.context);
        assert.equal(env.element('char_saver_paused_for_chat').checked, initiallyPaused);
        env.element('#extensions_settings #char-saver-settings').offsetParent = null;
        env.context.chat_metadata = { characterSaverWorld: 'Test', characterSaverPaused: !initiallyPaused };
        await env.handlers.chat();
        assert.equal(env.element('char_saver_paused_for_chat').checked, !initiallyPaused);
    });
}

test('pause state is restored from saved chat metadata after a reload', async () => {
    const env = setup();
    env.api.setPausedForChat(true);
    const savedMetadata = JSON.parse(JSON.stringify(env.context.chat_metadata));
    const reloaded = setup();
    reloaded.context.chat_metadata = savedMetadata;
    await vm.runInContext('renderSettings()', reloaded.context);
    assert.equal(reloaded.api.isPausedForChat(), true);
    assert.equal(reloaded.element('char_saver_paused_for_chat').checked, true);
});

for (const mode of ['creation', 'append', 'numbered']) {
    const update = mode !== 'creation';
    const messageFor = name => wrap(`<${update ? 'npc_update' : 'npc'} name="${name}">Text</${update ? 'npc_update' : 'npc'}>`, update);
    const process = (env, id) => update ? env.api.processUpdates(id) : env.api.processMessage(id);
    const makeEnv = () => setup({ separateUpdateEntries: mode === 'numbered' });

    test(`${mode}: pausing during lorebook loading cancels the write and preserves the message`, async () => {
        const env = makeEnv();
        const loadStarted = deferred();
        const finishLoad = deferred();
        const load = env.context.loadWorldInfo;
        env.context.loadWorldInfo = () => { loadStarted.resolve(); return finishLoad.promise; };
        const original = messageFor('Alice');
        env.context.chat.push({ mes: original });
        const pending = process(env, 0);
        await loadStarted.promise;
        env.api.setPausedForChat(true);
        finishLoad.resolve({ entries: {} });
        await pending;
        assert.equal(env.calls.save, 0);
        assert.equal(env.calls.chat, 0);
        assert.equal(env.calls.settings, 0);
        assert.equal(env.context.chat[0].mes, original);
        env.context.loadWorldInfo = load;
        env.api.setPausedForChat(false);
        await process(env, 0);
        assert.equal(env.calls.save, 1);
        assert.equal(env.context.chat[0].mes, '');
    });

    test(`${mode}: quickly unpausing does not revive a cancelled operation`, async () => {
        const env = makeEnv();
        const loadStarted = deferred();
        const finishLoad = deferred();
        env.context.loadWorldInfo = () => { loadStarted.resolve(); return finishLoad.promise; };
        const original = messageFor('Alice');
        env.context.chat.push({ mes: original });
        const pending = process(env, 0);
        await loadStarted.promise;
        env.api.setPausedForChat(true);
        env.api.setPausedForChat(false);
        finishLoad.resolve({ entries: {} });
        await pending;
        assert.equal(env.calls.save, 0);
        assert.equal(env.context.chat[0].mes, original);
    });

    test(`${mode}: pausing cancels queued writes and preserves their blocks`, async () => {
        const env = makeEnv();
        const saveStarted = deferred();
        const finishSave = deferred();
        const save = env.context.saveWorldInfo;
        env.context.saveWorldInfo = async (...args) => {
            saveStarted.resolve();
            await finishSave.promise;
            await save(...args);
        };
        env.context.chat.push({ mes: messageFor('Alice') }, { mes: messageFor('Bob') });
        const first = process(env, 0);
        await saveStarted.promise;
        const second = process(env, 1);
        // Allow the second operation to enter the lorebook's write queue.
        await new Promise(resolve => setImmediate(resolve));
        env.api.setPausedForChat(true);
        finishSave.resolve();
        await Promise.all([first, second]);
        assert.equal(env.calls.save, 1);
        assert.equal(env.context.chat[0].mes, '');
        assert.equal(env.context.chat[1].mes, messageFor('Bob'));
        assert.ok(!Object.values(env.world.entries).some(e => e.key?.[0] === 'Bob'));
    });

    test(`${mode}: cancelling after one save leaves subsequent blocks available for retry`, async () => {
        const env = makeEnv();
        const save = env.context.saveWorldInfo;
        env.context.saveWorldInfo = async (...args) => {
            await save(...args);
            env.api.setPausedForChat(true);
        };
        env.context.chat.push({ mes: messageFor('Alice') + '\n' + messageFor('Bob') });
        await process(env, 0);
        assert.equal(env.calls.save, 1);
        assert.equal(env.context.chat[0].mes, messageFor('Bob'));
        env.context.saveWorldInfo = save;
        env.api.setPausedForChat(false);
        await process(env, 0);
        assert.equal(env.calls.save, 2);
        assert.equal(env.context.chat[0].mes, '');
        assert.equal(Object.values(env.world.entries).filter(e => e.key?.[0] === 'Alice').length, 1);
    });

    test(`${mode}: a chat change during loading prevents writes to the previous chat`, async () => {
        const env = makeEnv();
        const loadStarted = deferred();
        const finishLoad = deferred();
        env.context.loadWorldInfo = () => { loadStarted.resolve(); return finishLoad.promise; };
        const original = messageFor('Alice');
        env.context.chat.push({ mes: original });
        const pending = process(env, 0);
        await loadStarted.promise;
        env.context.chat_metadata = { characterSaverWorld: 'Other' };
        env.context.chat = [{ mes: 'Another chat' }];
        await env.handlers.chat();
        finishLoad.resolve({ entries: {} });
        await pending;
        assert.equal(env.calls.save, 0);
        assert.equal(env.calls.chat, 0);
        assert.equal(env.context.chat[0].mes, 'Another chat');
    });
}

test('paused update blocks remain untouched and resume normally', async () => {
    const env = setup();
    const original = wrap('<npc_update name="Alice">Update</npc_update>', true);
    env.context.chat.push({ mes: original });
    env.api.setPausedForChat(true);
    await env.api.processUpdates(0);
    assert.equal(env.calls.save, 0);
    assert.equal(env.context.chat[0].mes, original);
    env.api.setPausedForChat(false);
    await env.api.processUpdates(0);
    assert.equal(env.calls.save, 1);
    assert.equal(env.context.chat[0].mes, '');
});

test('pausing between sibling update saves preserves the unsaved siblings', async () => {
    const env = setup({ separateUpdateEntries: true });
    const alice = '<npc_update name="Alice">First</npc_update>';
    const bob = '<npc_update name="Bob">Second</npc_update>';
    const save = env.context.saveWorldInfo;
    env.context.saveWorldInfo = async (...args) => {
        await save(...args);
        env.api.setPausedForChat(true);
    };
    env.context.chat.push({ mes: wrap(alice + '\n' + bob, true) });
    await env.api.processUpdates(0);
    assert.equal(env.calls.save, 1);
    assert.equal(env.context.chat[0].mes, wrap(bob, true));
    env.context.saveWorldInfo = save;
    env.api.setPausedForChat(false);
    await env.api.processUpdates(0);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment), ['Update Alice #1', 'Update Bob #1']);
    assert.equal(env.context.chat[0].mes, '');
});

test('the message event does not resume cancelled work after a quick pause and unpause', async () => {
    const env = setup();
    const save = env.context.saveWorldInfo;
    env.context.saveWorldInfo = async (...args) => {
        await save(...args);
        env.api.setPausedForChat(true);
        env.api.setPausedForChat(false);
    };
    const update = wrap('<npc_update name="Alice">Update</npc_update>', true);
    env.context.chat.push({ mes: wrap('<npc name="Alice">Creation</npc>') + '\n' + update });
    await env.handlers.message(0);
    assert.equal(env.calls.save, 1);
    assert.equal(env.context.chat[0].mes, update);
});

test('pausing while lorebook confirmation is pending prevents lorebook creation', async () => {
    const env = setup();
    const popupStarted = deferred();
    const confirmation = deferred();
    env.context.chat_metadata = {};
    env.context.POPUP_TYPE = { CONFIRM: 1 };
    env.context.callGenericPopup = () => { popupStarted.resolve(); return confirmation.promise; };
    let created = 0;
    env.context.createNewWorldInfo = async () => { created++; };
    const original = wrap('<npc name="Alice">Creation</npc>');
    env.context.chat.push({ mes: original });
    const pending = env.api.processMessage(0);
    await popupStarted.promise;
    env.api.setPausedForChat(true);
    confirmation.resolve(true);
    await pending;
    assert.equal(created, 0);
    assert.equal(env.calls.save, 0);
    assert.equal(env.context.chat[0].mes, original);
});

test('sanitizeWorldName strips ":" and whitespace from lorebook names only', () => {
    const { api } = setup();
    assert.equal(api.sanitizeWorldName('A: B \n C\tD'), 'A B C D');
    assert.equal(api.sanitizeWorldName(':::'), null);
    assert.equal(api.sanitizeWorldName('   '), null);
    assert.equal(api.sanitizeWorldName('My: Lorebook'), 'My Lorebook');
    assert.equal(api.sanitizeWorldName('Ok-Name_1'), 'Ok-Name_1');
});

test('lorebook scope defaults to chat and can be switched per character', async () => {
    const env = setup();
    await vm.runInContext('renderSettings()', env.context);
    const scope = env.element('char_saver_lorebook_scope');
    assert.equal(scope.value, 'chat');

    const select = env.element('char_saver_lorebook_select');
    assert.ok(select.innerHTML.includes('<option value="">(not set)</option>'));
    assert.ok(select.innerHTML.includes('<option value="Test">Test</option>'));
    assert.equal(select.value, 'Test');

    select.value = '';
    select.listeners.change();
    assert.equal('characterSaverWorld' in env.context.chat_metadata, false);

    select.value = 'Test';
    select.listeners.change();
    assert.equal(env.context.chat_metadata.characterSaverWorld, 'Test');

    scope.value = 'character';
    scope.listeners.change();
    assert.equal(env.context.extension_settings.characterSaver.lorebookScope, 'character');
    const characterSelect = env.element('char_saver_lorebook_select');
    assert.equal(characterSelect.value, '');

    characterSelect.value = 'Test';
    characterSelect.listeners.change();
    assert.equal(JSON.stringify(env.context.extension_settings.characterSaver.characterLorebooks), '{"avatar:Hero.png":"Test"}');
});

test('creating a lorebook from settings sanitizes the name and selects it', async () => {
    const env = setup();
    env.context.POPUP_TYPE = { CONFIRM: 1 };
    const created = [];
    env.context.createNewWorldInfo = async name => {
        created.push(name);
        env.context.world_names.push(name);
        await env.context.updateWorldInfoList();
        return true;
    };
    let listed = 0;
    env.context.updateWorldInfoList = () => { listed++; };

    await vm.runInContext('renderSettings()', env.context);
    const nameInput = env.element('char_saver_new_lorebook_name');
    const scope = env.element('char_saver_lorebook_scope');
    scope.value = 'chat';
    scope.listeners.change();

    nameInput.value = 'My: Fancy\nLorebook';
    await nameInput.listeners.change();
    assert.deepEqual(created, ['My Fancy Lorebook']);
    assert.equal(env.context.chat_metadata.characterSaverWorld, 'My Fancy Lorebook');
    assert.equal(nameInput.value, '');
    assert.equal(listed, 1);

    nameInput.value = 'Test';
    await nameInput.listeners.change();
    assert.equal(created.length, 1);
    assert.equal(env.context.chat_metadata.characterSaverWorld, 'Test');

    nameInput.value = ':::';
    await nameInput.listeners.change();
    assert.equal(created.length, 1);
});

test('unconfigured lorebook asks and stores the created book for the current scope', async () => {
    const env = setup();
    env.context.chat_metadata = {};
    env.context.POPUP_TYPE = { CONFIRM: 1 };
    env.context.callGenericPopup = async () => true;
    const created = [];
    const create = env.context.createNewWorldInfo;
    env.context.createNewWorldInfo = async name => { created.push(name); return create(name); };

    const original = wrap('<npc name="Alice">Creation</npc>');
    env.context.chat.push({ mes: original });
    await env.api.processMessage(0);

    assert.equal(created.length, 1);
    assert.ok(!created[0].includes(':'));
    assert.ok(created[0].startsWith('Hero Chat Lorebook '));
    assert.equal(env.context.chat_metadata.characterSaverWorld, created[0]);
    assert.equal(Object.keys(env.world.entries).length, 0);
    const newWorld = env.worlds[created[0]];
    assert.equal(newWorld.entries[0].key[0], 'Alice');
    assert.equal(env.context.chat[0].mes, '');
});

test('character scope persists the lorebook across chats of the same character', async () => {
    const first = setup({ lorebookScope: 'character', characterLorebooks: { Hero: 'Test' } });
    first.context.chat.push({ mes: wrap('<npc name="Alice">Creation</npc>') });
    await first.api.processMessage(0);
    assert.equal(first.world.entries[0].key[0], 'Alice');

    const second = setup({ lorebookScope: 'character', characterLorebooks: { Hero: 'Test' } });
    assert.equal(second.api.getConfiguredLorebookName(), 'Test');
});

test('existing native chat lorebooks remain usable after upgrading', async () => {
    const env = setup();
    env.context.chat_metadata = { world_info: 'Test' };
    let prompts = 0;
    env.context.callGenericPopup = async () => { prompts++; return false; };
    env.context.chat.push({ mes: wrap('<npc name="Alice">Text</npc>') });
    await env.api.processMessage(0);
    assert.equal(prompts, 0);
    assert.equal(env.calls.save, 1);
    assert.equal(env.world.entries[0].key[0], 'Alice');
    assert.equal(env.context.chat[0].mes, '');
});

test('clearing the chat selection also clears the native assignment without restoring it', () => {
    const env = setup();
    env.api.setConfiguredLorebookName(null);
    assert.equal(env.api.getConfiguredLorebookName(), null);
    assert.equal('world_info' in env.context.chat_metadata, false);
    assert.equal('characterSaverWorld' in env.context.chat_metadata, false);
    assert.equal(env.calls.metadata, 1);
});

test('selecting a book attaches it to native chat lore and updates the button', () => {
    const env = setup({}, { Other: { entries: {} } });
    env.context.world_names.push('Other');
    const classes = [];
    env.element('.chat_lorebook_button').classList.toggle = (...args) => classes.push(args);
    env.api.setConfiguredLorebookName('Other');
    assert.equal(env.context.chat_metadata.world_info, 'Other');
    assert.equal(env.context.chat_metadata.characterSaverWorld, 'Other');
    assert.deepEqual(classes, [['world_set', true]]);
    assert.equal(env.calls.metadata, 1);
});

test('legacy extension-only chat choices are activated on chat change', async () => {
    const env = setup();
    env.context.chat_metadata = { characterSaverWorld: 'Test' };
    await env.handlers.chat();
    assert.equal(env.context.chat_metadata.world_info, 'Test');
    assert.equal(env.calls.metadata, 1);
});

test('character choices are activated in each chat and after switching the scope', async () => {
    const env = setup({ lorebookScope: 'character', characterLorebooks: { 'avatar:Hero.png': 'Test' } });
    env.context.chat_metadata = {};
    await env.handlers.chat();
    assert.equal(env.context.chat_metadata.world_info, 'Test');
    assert.equal(env.api.getConfiguredLorebookName(), 'Test');
    env.context.chat_metadata = {};
    await env.handlers.chat();
    assert.equal(env.context.chat_metadata.world_info, 'Test');
    const scope = env.element('char_saver_lorebook_scope');
    scope.value = 'chat';
    scope.listeners.change();
    delete env.context.chat_metadata.world_info;
    scope.value = 'character';
    scope.listeners.change();
    assert.equal(env.context.chat_metadata.world_info, 'Test');
});

test('same-name cards keep separate choices and a display-name rename retains the choice', () => {
    const env = setup({ lorebookScope: 'character' });
    env.context.characters.push({ name: 'Hero', avatar: 'Hero_1.png' });
    env.context.world_names.push('Other');
    env.api.setConfiguredLorebookName('Test');
    env.context.this_chid = 1;
    assert.equal(env.api.getConfiguredLorebookName(), null);
    env.api.setConfiguredLorebookName('Other');
    env.context.this_chid = 0;
    assert.equal(env.api.getConfiguredLorebookName(), 'Test');
    env.context.characters[0].name = env.context.name2 = 'Renamed Hero';
    assert.equal(env.api.getConfiguredLorebookName(), 'Test');
    env.context.this_chid = 1;
    assert.equal(env.api.getConfiguredLorebookName(), 'Other');
});

test('unambiguous name-based character settings migrate once and can be cleared', () => {
    const env = setup({ lorebookScope: 'character', characterLorebooks: { Hero: 'Test' } });
    assert.equal(env.api.getConfiguredLorebookName(), 'Test');
    const saved = env.context.extension_settings.characterSaver.characterLorebooks;
    assert.equal(saved['avatar:Hero.png'], 'Test');
    assert.equal(Object.hasOwn(saved, 'Hero'), false);
    assert.equal(env.calls.settings, 1);
    assert.equal(env.api.getConfiguredLorebookName(), 'Test');
    assert.equal(env.calls.settings, 1);
    env.api.setConfiguredLorebookName(null);
    assert.equal(env.api.getConfiguredLorebookName(), null);
});

test('ambiguous legacy character names are never assigned to either card', () => {
    const env = setup({ lorebookScope: 'character', characterLorebooks: { Hero: 'Test' } });
    env.context.characters.push({ name: 'Hero', avatar: 'Hero_1.png' });
    assert.equal(env.api.getConfiguredLorebookName(), null);
    env.context.this_chid = 1;
    assert.equal(env.api.getConfiguredLorebookName(), null);
    assert.equal(env.calls.settings, 0);
});

for (const fromSettings of [false, true]) {
    const startCreation = env => fromSettings
        ? env.api.createLorebookFromInput('New book') : env.api.processMessage(0);
    const makeEnv = () => {
        const env = setup();
        env.context.chat_metadata = {};
        env.context.POPUP_TYPE = { CONFIRM: 1 };
        env.context.callGenericPopup = async () => true;
        env.context.chat.push({ mes: wrap('<npc name="Alice">Text</npc>') });
        return env;
    };

    test(`creation fromSettings=${fromSettings}: false never creates phantom selections or success notices`, async () => {
        const env = makeEnv();
        env.context.createNewWorldInfo = async () => false;
        let successes = 0;
        env.context.toastr = { success() { successes++; } };
        const original = env.context.chat[0].mes;
        await startCreation(env);
        assert.equal(env.api.getConfiguredLorebookName(), null);
        assert.deepEqual(Array.from(env.context.world_names), ['Test']);
        assert.equal(successes, 0);
        assert.equal(env.calls.save, 0);
        assert.equal(env.calls.delete, 0);
        assert.equal(env.context.chat[0].mes, original);
    });

    test(`creation fromSettings=${fromSettings}: switching chats rolls back the new empty book`, async () => {
        const env = makeEnv();
        const started = deferred();
        const finish = deferred();
        const create = env.context.createNewWorldInfo;
        env.context.createNewWorldInfo = async name => { started.resolve(); await finish.promise; return create(name); };
        const pending = startCreation(env);
        await started.promise;
        env.context.chat_metadata = { characterSaverWorld: 'Test', world_info: 'Test' };
        env.context.chat = [{ mes: 'Other chat' }];
        await env.handlers.chat();
        finish.resolve();
        await pending;
        assert.equal(env.calls.create, 1);
        assert.equal(env.calls.delete, 1);
        assert.equal(env.api.getConfiguredLorebookName(), 'Test');
        assert.equal(env.context.chat_metadata.world_info, 'Test');
        assert.equal(env.context.chat[0].mes, 'Other chat');
        assert.deepEqual(Object.keys(env.worlds), ['Test']);
        assert.deepEqual(Array.from(env.context.world_names), ['Test']);
        assert.equal(env.calls.save, 0);
    });

    test(`creation fromSettings=${fromSettings}: pausing retains the created book for future processing`, async () => {
        const env = makeEnv();
        const started = deferred();
        const finish = deferred();
        const create = env.context.createNewWorldInfo;
        env.context.createNewWorldInfo = async name => { started.resolve(); await finish.promise; return create(name); };
        const original = env.context.chat[0].mes;
        const pending = startCreation(env);
        await started.promise;
        env.api.setPausedForChat(true);
        finish.resolve();
        await pending;
        const selected = env.api.getConfiguredLorebookName();
        assert.ok(selected);
        assert.equal(env.context.chat_metadata.world_info, selected);
        assert.equal(env.calls.create, 1);
        assert.equal(env.calls.delete, 0);
        assert.equal(env.calls.save, 0);
        assert.equal(env.context.chat[0].mes, original);
        env.api.setPausedForChat(false);
        await env.api.processMessage(0);
        assert.equal(env.calls.create, 1);
        assert.equal(env.calls.save, 1);
        assert.equal(env.context.chat[0].mes, '');
    });
}

test('case-insensitive creation rejection preserves the existing book and selection', async () => {
    const env = setup();
    assert.equal(await env.api.createLorebookFromInput('test'), null);
    assert.equal(env.calls.create, 0);
    assert.equal(env.calls.delete, 0);
    assert.equal(env.api.getConfiguredLorebookName(), 'Test');
    assert.deepEqual(Array.from(env.context.world_names), ['Test']);
});

for (const change of ['scope', 'selection', 'character']) {
    test(`settings creation is cancelled when ${change} changes while awaiting the host`, async () => {
        const env = setup();
        const started = deferred();
        const finish = deferred();
        const create = env.context.createNewWorldInfo;
        env.context.createNewWorldInfo = async name => { started.resolve(); await finish.promise; return create(name); };
        const pending = env.api.createLorebookFromInput('New book');
        await started.promise;
        if (change === 'scope') {
            await vm.runInContext('renderSettings()', env.context);
            const scope = env.element('char_saver_lorebook_scope');
            scope.value = 'character';
            scope.listeners.change();
        } else if (change === 'selection') {
            env.api.setConfiguredLorebookName(null);
        } else {
            env.context.characters.push({ name: 'Other', avatar: 'Other.png' });
            env.context.this_chid = 1;
        }
        const before = JSON.stringify(env.context.chat_metadata);
        finish.resolve();
        assert.equal(await pending, null);
        assert.equal(JSON.stringify(env.context.chat_metadata), before);
        assert.equal(env.calls.delete, 1);
    });
}

test('rollback preserves a new book edited meanwhile and reports the retained book', async () => {
    const env = setup();
    const create = env.context.createNewWorldInfo;
    const warnings = [];
    env.context.toastr = { warning(message) { warnings.push(message); } };
    env.context.createNewWorldInfo = async name => {
        await create(name);
        env.worlds[name].entries[0] = { uid: 0, content: 'Edited elsewhere' };
        env.context.chat_metadata = {};
        return true;
    };
    assert.equal(await env.api.createLorebookFromInput('New book'), null);
    assert.equal(env.calls.delete, 0);
    assert.equal(env.worlds['New book'].entries[0].content, 'Edited elsewhere');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /New book/);
});

test('failed rollback is reported without modifying the destination chat', async () => {
    const env = setup();
    const create = env.context.createNewWorldInfo;
    const warnings = [];
    env.context.toastr = { warning(message) { warnings.push(message); } };
    env.context.deleteWorldInfo = async () => false;
    env.context.createNewWorldInfo = async name => {
        await create(name);
        env.context.chat_metadata = { world_info: 'Test' };
        return true;
    };
    assert.equal(await env.api.createLorebookFromInput('New book'), null);
    assert.equal(env.context.chat_metadata.world_info, 'Test');
    assert.equal(warnings.length, 1);
});

test('duplicate MESSAGE_RECEIVED events for one message save each block only once', async () => {
    const env = setup();
    const update = '<npc_update name="Alice">Update</npc_update>';
    env.context.chat.push({ mes: wrap('<npc name="Alice">Creation</npc>') + '\n' + wrap(update, true) });
    await Promise.all([env.handlers.message(0), env.handlers.message(0), env.handlers.message(0)]);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment),
        ['Character: Alice', 'All NPC', 'Update for Alice']);
    assert.equal(env.world.entries[1].content, 'Known NPC=\nname=Alice');
    assert.equal(env.world.entries[2].content, update);
    assert.equal(env.calls.save, 2);
    assert.equal(env.context.chat[0].mes, '');
});

test('separate mode: duplicate concurrent events create only one numbered entry', async () => {
    const env = setup({ separateUpdateEntries: true });
    const update = 'Name: Alice\nPromoted.';
    env.context.chat.push({ mes: wrap(update, true) });
    await Promise.all([env.handlers.message(0), env.handlers.message(0)]);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment), ['Update Alice #1']);
    assert.equal(env.world.entries[0].content, update);
    assert.equal(env.calls.save, 1);
    assert.equal(env.context.chat[0].mes, '');
});

test('identical update block twice in one message is appended only once', async () => {
    const env = setup();
    const update = 'Name: Alice\nPromoted to Captain.';
    env.context.chat.push({ mes: `${wrap(update, true)}\n${wrap(update, true)}` });
    await env.handlers.message(0);
    const entries = Object.values(env.world.entries).filter(e => (e.comment || '').startsWith('Update'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, update);
    assert.equal(env.calls.save, 1);
    assert.equal(env.context.chat[0].mes, '');
});

test('separate mode: identical update block twice in one message creates only one entry', async () => {
    const env = setup({ separateUpdateEntries: true });
    const update = 'Name: Alice\nPromoted to Captain.';
    env.context.chat.push({ mes: `${wrap(update, true)}\n${wrap(update, true)}` });
    await env.handlers.message(0);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment), ['Update Alice #1']);
    assert.equal(env.calls.save, 1);
    assert.equal(env.context.chat[0].mes, '');
});

test('regenerated message with an identical update block does not append it again', async () => {
    const env = setup();
    const update = 'Name: Alice\nPromoted to Captain.';
    env.context.chat.push({ mes: wrap(update, true) });
    await env.handlers.message(0);
    env.context.chat[0].mes = wrap(update, true);
    await env.handlers.message(0);
    const entries = Object.values(env.world.entries).filter(e => (e.comment || '').startsWith('Update'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, update);
    assert.equal(env.calls.save, 1);
});

test('regenerated message in separate mode with identical block does not create a second entry', async () => {
    const env = setup({ separateUpdateEntries: true });
    const update = 'Name: Alice\nPromoted to Captain.';
    env.context.chat.push({ mes: wrap(update, true) });
    await env.handlers.message(0);
    env.context.chat[0].mes = wrap(update, true);
    await env.handlers.message(0);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment), ['Update Alice #1']);
    assert.equal(env.calls.save, 1);
});

test('identical character creation twice (duplicate event) creates one entry and one All NPC line', async () => {
    const env = setup();
    const npc = '<npc name="Alice" role="captain">Description.</npc>';
    env.context.chat.push({ mes: wrap(npc) });
    await Promise.all([env.handlers.message(0), env.handlers.message(0)]);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment), ['Character: Alice', 'All NPC']);
    assert.equal(env.world.entries[1].content, 'Known NPC=\nname=Alice, role=captain');
    assert.equal(env.calls.save, 1);
});

test('distinct updates still append and numbered entries still increment', async () => {
    const env = setup({ separateUpdateEntries: true });
    env.context.chat.push({ mes: wrap('Name: Alice\nFirst.', true) });
    await env.handlers.message(0);
    env.context.chat.push({ mes: wrap('Name: Alice\nSecond.', true) });
    await env.handlers.message(1);
    // Similar-but-different content must not be treated as duplicate.
    env.context.chat.push({ mes: wrap('Name: Alice\nFirst. Extra line.', true) });
    await env.handlers.message(2);
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment),
        ['Update Alice #1', 'Update Alice #2', 'Update Alice #3']);
    assert.equal(env.calls.save, 3);
});

test('append mode: distinct updates still append to the same entry', async () => {
    const env = setup();
    env.context.chat.push({ mes: wrap('Name: Alice\nFirst.', true) });
    await env.handlers.message(0);
    env.context.chat.push({ mes: wrap('Name: Alice\nSecond.', true) });
    await env.handlers.message(1);
    const entries = Object.values(env.world.entries).filter(e => (e.comment || '').startsWith('Update'));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, 'Name: Alice\nFirst.\nName: Alice\nSecond.');
    assert.equal(env.calls.save, 2);
});

test('duplicate detection also matches legacy numbered entries', async () => {
    const env = setup({ separateUpdateEntries: true }, { Test: { entries: {
        0: { uid: 0, comment: 'Update #4 for Alice', content: 'Name: Alice\nOld.' },
    } } });
    await env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Name: Alice\nOld.');
    assert.deepEqual(Object.values(env.world.entries).map(e => e.comment), ['Update #4 for Alice']);
    assert.equal(env.calls.save, 0);
    await env.api.createOrUpdateLorebookEntry('Test', 'Alice', 'Name: Alice\nNew.');
    assert.equal(env.world.entries[1].comment, 'Update Alice #5');
    assert.equal(env.calls.save, 1);
});
