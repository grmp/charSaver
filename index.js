// Character Saver Extension for SillyTavern
// Saves characters introduced by the AI to an explicitly selected lorebook.

const MODULE_NAME = 'CharacterSaver';

// Default settings
const defaultSettings = {
    paused: false,
    characterLorebooks: [],
    // Character creation settings
    startDelimiter: '<!-- new character start',
    endDelimiter: 'new character end -->',

    // Character update settings
    updateStartDelimiter: '<!-- update character start',
    updateEndDelimiter: 'update character end -->',
    separateUpdateEntries: false,
    updateEntryCounters: [],
};

// Current settings (will be loaded from extension_settings)
let settings = { ...defaultSettings };

// Serialize all entry writes to a lorebook, including character creation.
const worldWriteQueues = new Map();

async function queueWorldWrite(worldName, write) {
    const previous = worldWriteQueues.get(worldName) || Promise.resolve();
    const pending = previous.catch(() => {}).then(write);
    worldWriteQueues.set(worldName, pending);
    try {
        return await pending;
    } finally {
        if (worldWriteQueues.get(worldName) === pending) {
            worldWriteQueues.delete(worldName);
        }
    }
}

// Get current delimiters from settings
const START_DELIMITER = () => settings.startDelimiter;
const END_DELIMITER = () => settings.endDelimiter;

// Import required modules
// Note: Third-party extensions are in public/scripts/extensions/third-party/NAME/
// So we need to go up 4 levels to reach public/
import {
    chat,
    chat_metadata,
    updateMessageBlock,
    saveChatConditional,
    saveMetadata,
    name2,
    saveSettingsDebounced,
} from '../../../../script.js';

import {
    world_names,
    loadWorldInfo,
    createWorldInfoEntry,
    saveWorldInfo,
    createNewWorldInfo,
    updateWorldInfoList,
} from '../../../../scripts/world-info.js';

import {
    eventSource,
    event_types,
} from '../../../../scripts/events.js';

import {
    extension_settings,
    getContext,
} from '../../../../scripts/extensions.js';

import {
    callGenericPopup,
    POPUP_TYPE,
} from '../../../../scripts/popup.js';

console.log(`[${MODULE_NAME}] All imports successful`);

/**
 * Loads settings from extension_settings
 */
function loadSettings() {
    if (extension_settings && extension_settings.characterSaver) {
        settings = { ...defaultSettings, ...extension_settings.characterSaver };
        console.log(`[${MODULE_NAME}] Settings loaded:`, settings);
    } else {
        settings = { ...defaultSettings };
        console.log(`[${MODULE_NAME}] Using default settings:`, settings);
    }
}

/**
 * Saves current settings to extension_settings
 */
function saveSettings() {
    if (extension_settings) {
        extension_settings.characterSaver = { ...settings };
        saveSettingsDebounced();
        console.log(`[${MODULE_NAME}] Settings saved:`, settings);
    }
}

/**
 * Renders the extension settings UI
 */
async function renderSettings() {
    const container = document.querySelector('#char-saver-settings');
    if (!container) {
        console.warn(`[${MODULE_NAME}] Settings container not found`);
        return;
    }

    // Build HTML inline (for development when extension is outside SillyTavern folder)
    container.innerHTML = `
<div class="character_saver_settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Character Saver</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <div class="marginBot5">
                <label class="checkbox_label" for="char_saver_paused">
                    <input id="char_saver_paused" type="checkbox">
                    <span>Pause</span>
                </label>
            </div>

            <div class="marginBot5">
                <label for="char_saver_lorebook_scope">Lorebook scope</label>
                <select id="char_saver_lorebook_scope" class="text_pole">
                    <option value="chat">Chat</option>
                    <option value="character">Character</option>
                </select>
                <label for="char_saver_lorebook">Lorebook</label>
                <select id="char_saver_lorebook" class="text_pole"></select>
                <button id="char_saver_create_lorebook" class="menu_button" type="button">Create Lorebook</button>
                <button id="char_saver_refresh_lorebooks" class="menu_button" type="button">Refresh Lorebooks</button>
                <small id="char_saver_lorebook_status" role="status"></small>
            </div>

            <hr class="sysHR">

            <div class="marginBot5">
                <label>Character Creation</label>
                <div class="marginBot5">
                    <label for="char_saver_start_delimiter">Start Delimiter</label>
                    <input id="char_saver_start_delimiter" class="text_pole" type="text" placeholder="<!-- new character start">
                    <small>Text that marks the beginning of a character introduction block</small>
                </div>
                <div class="marginBot5">
                    <label for="char_saver_end_delimiter">End Delimiter</label>
                    <input id="char_saver_end_delimiter" class="text_pole" type="text" placeholder="new character end -->">
                    <small>Text that marks the end of a character introduction block</small>
                </div>
            </div>

            <hr class="sysHR">

            <div class="marginBot5">
                <label>Character Updates</label>
                <div class="marginBot5">
                    <label class="checkbox_label" for="char_saver_separate_update_entries">
                        <input id="char_saver_separate_update_entries" type="checkbox">
                        <span>Save each update as a separate entry</span>
                    </label>
                    <small>Off: append to "Update for [Name]". On: create "Update [Name] #1", "Update [Name] #2", etc. Numbers increase per character and lorebook, even after deleting entries.</small>
                </div>
                <div class="marginBot5">
                    <label for="char_saver_update_start_delimiter">Start Delimiter</label>
                    <input id="char_saver_update_start_delimiter" class="text_pole" type="text" placeholder="<!-- update character start">
                    <small>Text that marks the beginning of a character progression block</small>
                </div>
                <div class="marginBot5">
                    <label for="char_saver_update_end_delimiter">End Delimiter</label>
                    <input id="char_saver_update_end_delimiter" class="text_pole" type="text" placeholder="update character end -->">
                    <small>Text that marks the end of a character progression block</small>
                </div>
            </div>

            <hr class="sysHR">

            <div class="marginBot5">
                <label>Info</label>
                <p class="margin0">
                    Character Saver saves characters introduced by the AI to the selected lorebook:
                </p>
                <ul class="margin0">
                    <li><b>Character Creation:</b> Extracts the character name and description, creates a new lorebook entry</li>
                    <li><b>Character Updates:</b> Appends to "Update for [Name]" or creates separate numbered entries, depending on the setting above</li>
                    <li>Delimiter blocks are removed from messages after processing</li>
                </ul>
            </div>
        </div>
    </div>
</div>`;

    const pauseInput = document.getElementById('char_saver_paused');
    pauseInput.checked = settings.paused === true;
    pauseInput.addEventListener('change', () => {
        settings.paused = pauseInput.checked;
        saveSettings();
    });

    const scopeInput = document.getElementById('char_saver_lorebook_scope');
    scopeInput.addEventListener('change', async () => {
        const target = getLorebookTarget();
        if (!target.chatId || (scopeInput.value === 'character' && !target.avatar)) return;
        const previous = chat_metadata.characterSaver;
        const next = { ...previous, lorebookScope: scopeInput.value };
        chat_metadata.characterSaver = next;
        try {
            await saveMetadata();
        } catch (error) {
            if (target.metadata.characterSaver === next) target.metadata.characterSaver = previous;
            console.error(`[${MODULE_NAME}] Failed to save lorebook scope:`, error);
            notifyLorebook('Could not save the lorebook scope.', 'error');
        } finally {
            renderLorebookControls();
        }
    });

    document.getElementById('char_saver_lorebook').addEventListener('change', async event => {
        try {
            await saveLorebookSelection(getLorebookTarget(), event.target.value);
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to save lorebook selection:`, error);
            notifyLorebook('Could not save the lorebook selection.', 'error');
        } finally {
            renderLorebookControls();
        }
    });
    document.getElementById('char_saver_create_lorebook').addEventListener('click', createSelectedLorebook);
    document.getElementById('char_saver_refresh_lorebooks').addEventListener('click', async () => {
        try {
            await updateWorldInfoList();
            renderLorebookControls();
        } catch (error) {
            console.error(`[${MODULE_NAME}] Failed to refresh lorebooks:`, error);
            notifyLorebook('Could not refresh lorebooks.', 'error');
        }
    });
    renderLorebookControls();

    // Get input elements
    const startInput = document.getElementById('char_saver_start_delimiter');
    const endInput = document.getElementById('char_saver_end_delimiter');
    const updateStartInput = document.getElementById('char_saver_update_start_delimiter');
    const updateEndInput = document.getElementById('char_saver_update_end_delimiter');
    const separateUpdatesInput = document.getElementById('char_saver_separate_update_entries');

    if (separateUpdatesInput) {
        separateUpdatesInput.checked = settings.separateUpdateEntries === true;
        separateUpdatesInput.addEventListener('change', () => {
            settings.separateUpdateEntries = separateUpdatesInput.checked;
            saveSettings();
        });
    }

    if (startInput) {
        startInput.value = settings.startDelimiter;
        startInput.addEventListener('input', () => {
            settings.startDelimiter = startInput.value;
            saveSettings();
        });
    }

    if (endInput) {
        endInput.value = settings.endDelimiter;
        endInput.addEventListener('input', () => {
            settings.endDelimiter = endInput.value;
            saveSettings();
        });
    }

    if (updateStartInput) {
        updateStartInput.value = settings.updateStartDelimiter;
        updateStartInput.addEventListener('input', () => {
            settings.updateStartDelimiter = updateStartInput.value;
            saveSettings();
        });
    }

    if (updateEndInput) {
        updateEndInput.value = settings.updateEndDelimiter;
        updateEndInput.addEventListener('input', () => {
            settings.updateEndDelimiter = updateEndInput.value;
            saveSettings();
        });
    }

    console.log(`[${MODULE_NAME}] Settings UI rendered`);
}

// Initialize settings
loadSettings();

// Add settings button to extensions menu
eventSource.on(event_types.APP_READY, async () => {
    const extensionsMenu = document.getElementById('extensions_settings');
    if (extensionsMenu) {
        const settingsButton = document.createElement('div');
        settingsButton.id = 'char-saver-settings';
        extensionsMenu.appendChild(settingsButton);
        await renderSettings();
    }
});

// Restore the current chat/character selection even when the settings drawer is hidden.
eventSource.on(event_types.CHAT_CHANGED, async () => {
    const container = document.querySelector('#extensions_settings #char-saver-settings');
    if (container) {
        await renderSettings();
    }
});

/**
 * Escapes special regex characters
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects all character introduction blocks in a message
 */
function detectCharacterBlocks(messageContent) {
    const blocks = [];
    const regex = new RegExp(
        `${escapeRegExp(START_DELIMITER())}([\\s\\S]*?)${escapeRegExp(END_DELIMITER())}`,
        'gi'
    );

    let match;
    while ((match = regex.exec(messageContent)) !== null) {
        blocks.push(match[0].trim());
    }

    return blocks;
}

/**
 * Detects all character progression update blocks in a message
 */
function detectUpdateBlocks(messageContent) {
    const blocks = [];
    const regex = new RegExp(
        `${escapeRegExp(settings.updateStartDelimiter)}([\\s\\S]*?)${escapeRegExp(settings.updateEndDelimiter)}`,
        'gi'
    );

    let match;
    while ((match = regex.exec(messageContent)) !== null) {
        blocks.push(match[0].trim());
    }

    return blocks;
}

/**
 * Reads NPC attributes without parsing or rewriting the stored XML.
 * A non-null result also marks tag content that must survive legacy fallback.
 */
function extractNpcName(content) {
    const tags = /<(?:npc_update|npc)(?=[\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>/gi;
    let result = null;

    for (const tag of content.matchAll(tags)) {
        result = { name: null, attributes: [] };
        // Consume complete attributes so a quoted value containing `name=`
        // cannot be mistaken for the actual name attribute.
        const attributes = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
        for (const attribute of tag[1].matchAll(attributes)) {
            result.attributes.push([attribute[1], attribute[2] ?? attribute[3] ?? attribute[4]]);
            if (attribute[1].toLowerCase() !== 'name') continue;
            const name = (attribute[2] ?? attribute[3] ?? '').trim();
            if (name && !result.name) result.name = name;
        }
        if (result.name) return result;
    }

    return result;
}

/**
 * Removes boundary markers while preserving the content inside the block.
 */
function stripBlockDelimiters(block, startDelimiter, endDelimiter) {
    // Some responses wrap the closing marker in its own HTML comment.
    // Consume that opener only at the boundary of a comment-style delimiter.
    const optionalOpener = endDelimiter.trimEnd().endsWith('-->')
        && !endDelimiter.trimStart().startsWith('<!--') ? '(?:<!--\\s*)?' : '';
    return block.trim()
        .replace(new RegExp(`^${escapeRegExp(startDelimiter)}`, 'i'), '')
        .replace(new RegExp(`${optionalOpener}${escapeRegExp(endDelimiter)}$`, 'i'), '')
        .trim();
}

/**
 * Parses a character block to extract name and description
 */
function parseCharacterBlock(block) {
    try {
        const content = stripBlockDelimiters(block, START_DELIMITER(), END_DELIMITER());

        const npc = extractNpcName(content);
        if (npc?.name) {
            return { name: npc.name, description: content };
        }

        // Look for Name: field (with or without bold markdown, various whitespace)
        // Or just a bolded name like **John Doe**
        const namePatterns = [
            /\*\*Name:\*\*\s*(.+)/im,           // **Name:** X
            /\*\*Name\*\*:\s*(.+)/im,            // **Name**: X
            /Name\s*:\s*(.+)/im,                 // Name: X
            /^\*\*([^*]+)\*\*\s*$/m,             // **John Doe** (standalone, first line)
            /\*\*([^*]+)\*\*\s*[\r\n]/,          // **John Doe** (followed by newline)
        ];

        let characterName = null;
        let namePatternUsed = null;

        for (const pattern of namePatterns) {
            const match = content.match(pattern);
            if (match) {
                characterName = match[1].trim();
                namePatternUsed = pattern;
                console.log(`[${MODULE_NAME}] Found character name: '${characterName}'`);
                break;
            }
        }

        if (!characterName) {
            console.warn(`[${MODULE_NAME}] Could not extract character name from block`);
            console.debug(`[${MODULE_NAME}] Block content:`, content);
            return null;
        }

        if (!characterName) {
            console.warn(`[${MODULE_NAME}] Empty character name in block`);
            return null;
        }

        // The entire block (excluding delimiters) is the description
        // Remove the Name line from the description to avoid redundancy
        const description = namePatternUsed && !npc ? content.replace(namePatternUsed, '').trim() : content.trim();

        return {
            name: characterName,
            description: description || `Character named ${characterName}`,
        };
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error parsing character block:`, error);
        return null;
    }
}

/**
 * Removes character progression update blocks from a message
 */
function removeUpdateBlocks(messageContent) {
    const regex = new RegExp(
        `\\s*${escapeRegExp(settings.updateStartDelimiter)}[\\s\\S]*?${escapeRegExp(settings.updateEndDelimiter)}\\s*`,
        'gi'
    );

    return messageContent.replace(regex, '').trim();
}

/**
 * Removes character introduction blocks from a message
 */
function removeCharacterBlocks(messageContent) {
    const regex = new RegExp(
        `\\s*${escapeRegExp(START_DELIMITER())}[\\s\\S]*?${escapeRegExp(END_DELIMITER())}\\s*`,
        'gi'
    );

    return messageContent.replace(regex, '').trim();
}

/**
 * Parses a character progression update block to extract name and content
 */
function parseUpdateBlock(block) {
    try {
        const content = stripBlockDelimiters(block, settings.updateStartDelimiter, settings.updateEndDelimiter);

        const npc = extractNpcName(content);
        if (npc?.name) {
            return { name: npc.name, content };
        }

        // Reuse the same namePatterns from parseCharacterBlock for consistency
        const namePatterns = [
            /\*\*Name:\*\*\s*(.+)/im,
            /\*\*Name\*\*:\s*(.+)/im,
            /Name\s*:\s*(.+)/im,
            /^\*\*([^*]+)\*\*\s*$/m,
            /\*\*([^*]+)\*\*\s*[\r\n]/,
        ];

        let characterName = null;

        for (const pattern of namePatterns) {
            const match = content.match(pattern);
            if (match) {
                characterName = match[1].trim();
                break;
            }
        }

        if (!characterName) {
            console.warn(`[${MODULE_NAME}] Could not extract character name from update block`);
            return null;
        }

        // All content is the update
        return {
            name: characterName,
            content: content,
        };
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error parsing update block:`, error);
        return null;
    }
}

/** Character targets use the avatar filename, never the mutable list index/name. */
function getLorebookTarget() {
    const context = getContext();
    const avatar = context.groupId ? null : context.characters?.[context.characterId]?.avatar;
    const characterBooks = Array.isArray(settings.characterLorebooks) ? settings.characterLorebooks : [];
    const characterBook = avatar ? characterBooks.find(book => book.avatar === avatar) : null;
    const chatSettings = chat_metadata.characterSaver;
    const scope = chatSettings?.lorebookScope === 'chat' ? 'chat'
        : avatar && (chatSettings?.lorebookScope === 'character' || characterBook) ? 'character' : 'chat';
    return {
        chatId: context.chatId,
        groupId: context.groupId,
        avatar,
        metadata: chat_metadata,
        scope,
        worldName: (scope === 'character' ? characterBook?.worldName : chatSettings?.selectedLorebook) || '',
    };
}

function isCurrentLorebookTarget(target) {
    const current = getLorebookTarget();
    return target.chatId === current.chatId && target.groupId === current.groupId
        && target.avatar === current.avatar && target.metadata === current.metadata
        && target.scope === current.scope && target.worldName === current.worldName;
}

async function saveLorebookSelection(target, worldName) {
    if (!target.chatId || !isCurrentLorebookTarget(target)
        || (worldName && !world_names.includes(worldName))) return false;
    if (target.scope === 'character') {
        if (!target.avatar) return false;
        const books = Array.isArray(settings.characterLorebooks) ? settings.characterLorebooks : [];
        settings.characterLorebooks = books.filter(book => book.avatar !== target.avatar);
        settings.characterLorebooks.push({ avatar: target.avatar, worldName });
        saveSettings();
    } else {
        const previous = chat_metadata.characterSaver;
        const next = { ...previous, selectedLorebook: worldName, lorebookScope: 'chat' };
        chat_metadata.characterSaver = next;
        try {
            await saveMetadata();
        } catch (error) {
            if (target.metadata.characterSaver === next) target.metadata.characterSaver = previous;
            throw error;
        }
    }
    return true;
}

function notifyLorebook(message, level = 'warning') {
    if (typeof toastr !== 'undefined') {
        toastr[level](message, MODULE_NAME, { timeOut: 5000, preventDuplicates: true });
    }
}

let creatingLorebook = false;

function renderLorebookControls() {
    const select = document.getElementById('char_saver_lorebook');
    if (!select) return;
    const target = getLorebookTarget();
    const scopeInput = document.getElementById('char_saver_lorebook_scope');
    scopeInput.value = target.scope;
    scopeInput.querySelector('option[value="character"]').disabled = !target.avatar;
    scopeInput.disabled = !target.chatId || creatingLorebook;
    // Native DOM options keep lorebook names out of HTML markup.
    select.replaceChildren();
    const addOption = (value, label, disabled = false) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.disabled = disabled;
        select.appendChild(option);
    };
    addOption('', 'No lorebook selected');
    for (const worldName of world_names) addOption(worldName, worldName);
    const missing = target.worldName && !world_names.includes(target.worldName);
    if (missing) addOption(target.worldName, `${target.worldName} (unavailable)`, true);
    select.value = target.worldName;
    select.disabled = !target.chatId || creatingLorebook;
    document.getElementById('char_saver_create_lorebook').disabled = !target.chatId || creatingLorebook;
    document.getElementById('char_saver_lorebook_status').textContent = !target.chatId
        ? 'Open a chat to select a lorebook.' : missing
            ? 'The selected lorebook is unavailable. Select another lorebook or refresh the list.'
            : target.scope === 'character'
                ? 'Shared by chats with this character that use Character scope. The chat-bound lorebook is unchanged.'
                : 'Used only in this chat. The chat-bound lorebook is unchanged.';
}

function suggestedLorebookName() {
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const base = `${name2 || 'Chat'} Lorebook ${date}_${time}`.replace(/:/g, '-');
    let name = base;
    for (let suffix = 2; world_names.includes(name); suffix++) name = `${base} (${suffix})`;
    return name;
}

async function createSelectedLorebook() {
    const target = getLorebookTarget();
    if (!target.chatId || creatingLorebook) return;
    creatingLorebook = true;
    renderLorebookControls();
    try {
        const answer = await callGenericPopup('Lorebook name', POPUP_TYPE.INPUT, suggestedLorebookName(), { okButton: 'Create Lorebook' });
        if (typeof answer !== 'string') return;
        const worldName = answer.trim();
        if (!worldName) {
            notifyLorebook('Enter a lorebook name.');
            return;
        }
        if (!isCurrentLorebookTarget(target)) return;
        await updateWorldInfoList();
        if (!isCurrentLorebookTarget(target)) return;
        if (world_names.includes(worldName)) {
            notifyLorebook('A lorebook with this name already exists. Select it from the list or use another name.');
            return;
        }
        const result = await createNewWorldInfo(worldName, { interactive: false });
        if (result === false) throw new Error('Lorebook creation failed');
        await updateWorldInfoList();
        if (!world_names.includes(worldName) || !(await loadWorldInfo(worldName))) {
            throw new Error('Created lorebook could not be loaded');
        }
        if (!await saveLorebookSelection(target, worldName)) {
            notifyLorebook('Lorebook created. Select it in Settings; the active chat or selection changed.', 'info');
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to create lorebook:`, error);
        notifyLorebook('Could not create and select the lorebook. Your previous selection has been kept.', 'error');
    } finally {
        creatingLorebook = false;
        renderLorebookControls();
    }
}

function getSelectedWorldInfoName() {
    const target = getLorebookTarget();
    if (target.chatId && target.worldName && world_names.includes(target.worldName)) return target.worldName;
    notifyLorebook('Select an available lorebook in Extensions → Character Saver, below Pause.');
    return null;
}

/**
 * Finds an existing update entry for a character by comment
 */
function findUpdateEntry(worldData, characterName) {
    const targetComment = `Update for ${characterName}`;

    for (const entry of Object.values(worldData.entries || {})) {
        if (entry.comment === targetComment) {
            return entry;
        }
    }

    return null;
}

/**
 * Creates a new lorebook entry for a character
 */
async function createLorebookEntry(worldName, characterName, description) {
    return queueWorldWrite(worldName, async () => {
        try {
            console.log(`[${MODULE_NAME}] Creating entry for '${characterName}' in World Info: '${worldName}'`);

            const worldData = structuredClone(await loadWorldInfo(worldName));

            if (!worldData) {
                console.error(`[${MODULE_NAME}] Failed to load World Info: ${worldName}`);
                return false;
            }

            console.log(`[${MODULE_NAME}] World Info loaded, entries before:`, Object.keys(worldData.entries || {}).length);

            const newEntry = createWorldInfoEntry(worldName, worldData);

            console.log(`[${MODULE_NAME}] Created new entry with UID:`, newEntry.uid);

            newEntry.key = [characterName];
            newEntry.keysecondary = [];
            newEntry.content = description;
            newEntry.comment = `Character: ${characterName}`;
            newEntry.order = 99;
            newEntry.constant = false;
            newEntry.selective = false;
            newEntry.depth = 4;
            newEntry.probability = 100;
            newEntry.position = 0;
            newEntry.vectorized = true;

            let allNpcEntry = Object.values(worldData.entries || {}).find(entry => entry.comment === 'All NPC');
            if (!allNpcEntry) {
                allNpcEntry = createWorldInfoEntry(worldName, worldData);
                allNpcEntry.comment = 'All NPC';
                allNpcEntry.key = ['All NPC'];
                allNpcEntry.keysecondary = [];
                allNpcEntry.content = '';
                allNpcEntry.order = 98;
                allNpcEntry.constant = true;
                allNpcEntry.selective = false;
                allNpcEntry.depth = 4;
                allNpcEntry.probability = 100;
                allNpcEntry.position = 0;
                allNpcEntry.vectorized = false;
            }
            const npc = extractNpcName(description);
            const attributes = npc?.attributes.length ? npc.attributes : [['name', characterName]];
            const line = attributes.map(([key, value]) => `${key}=${value}`).join(', ');
            if (!allNpcEntry.content?.startsWith('Known NPC=')) {
                allNpcEntry.content = allNpcEntry.content ? `Known NPC=\n${allNpcEntry.content}` : 'Known NPC=';
            }
            allNpcEntry.content = allNpcEntry.content ? `${allNpcEntry.content}\n${line}` : line;

            console.log(`[${MODULE_NAME}] Saving World Info with`, Object.keys(worldData.entries || {}).length, 'entries');

            await saveWorldInfo(worldName, worldData, true);

            console.log(`[${MODULE_NAME}] World Info saved successfully for: ${characterName}`);
            return true;
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error creating lorebook entry:`, error);
            return false;
        }
    });
}

/**
 * Chooses a number above both the saved high-water mark and existing entries.
 */
function nextUpdateNumber(worldData, worldName, characterName) {
    const counters = Array.isArray(settings.updateEntryCounters) ? settings.updateEntryCounters : [];
    let highest = 0;
    for (const counter of counters) {
        if (counter?.worldName === worldName && counter.characterName === characterName
            && Number.isSafeInteger(counter.lastNumber) && counter.lastNumber > highest) {
            highest = counter.lastNumber;
        }
    }
    for (const entry of Object.values(worldData.entries || {})) {
        const comment = entry.comment || '';
        const current = /^Update ([\s\S]*) #([1-9]\d*)$/.exec(comment);
        const legacy = /^Update #([1-9]\d*) for ([\s\S]*)$/.exec(comment);
        const matchingNumbers = [];
        if (current && current[1] === characterName) matchingNumbers.push(current[2]);
        if (legacy && legacy[2] === characterName) matchingNumbers.push(legacy[1]);
        for (const value of matchingNumbers) {
            const number = Number(value);
            if (!Number.isSafeInteger(number)) throw new Error('Update number exceeds safe integer range');
            highest = Math.max(highest, number);
        }
    }
    if (highest >= Number.MAX_SAFE_INTEGER) throw new Error('Update number exceeds safe integer range');
    return highest + 1;
}

/**
 * Creates a numbered update entry or appends to the unnumbered entry.
 */
async function createOrUpdateLorebookEntry(worldName, characterName, updateContent) {
    const separateUpdates = settings.separateUpdateEntries === true;
    return queueWorldWrite(worldName, async () => {
        try {
            console.log(`[${MODULE_NAME}] Creating/updating entry for '${characterName}' in World Info: '${worldName}'`);

            const worldData = structuredClone(await loadWorldInfo(worldName));

            if (!worldData) {
                console.error(`[${MODULE_NAME}] Failed to load World Info: ${worldName}`);
                return false;
            }

            const number = separateUpdates ? nextUpdateNumber(worldData, worldName, characterName) : null;
            const existingEntry = separateUpdates ? null : findUpdateEntry(worldData, characterName);

            if (existingEntry) {
                // Append to existing entry
                existingEntry.constant = false;
                existingEntry.vectorized = true;
                existingEntry.content += '\n' + updateContent;
                console.log(`[${MODULE_NAME}] Appended to existing update entry for '${characterName}'`);
            } else {
                // Create new entry
                const newEntry = createWorldInfoEntry(worldName, worldData);
                newEntry.key = [characterName]; // Same trigger as character entries
                newEntry.keysecondary = [];
                newEntry.content = updateContent;
                newEntry.comment = separateUpdates ? `Update ${characterName} #${number}` : `Update for ${characterName}`;
                newEntry.order = 100;
                newEntry.constant = false;
                newEntry.vectorized = true;
                newEntry.selective = false;
                newEntry.depth = 4;
                newEntry.probability = 100;
                newEntry.position = 0;
                console.log(`[${MODULE_NAME}] Created new update entry for '${characterName}'`);
            }

            await saveWorldInfo(worldName, worldData, true);
            if (separateUpdates) {
                const counters = Array.isArray(settings.updateEntryCounters) ? settings.updateEntryCounters : [];
                settings.updateEntryCounters = counters.filter(counter =>
                    counter?.worldName !== worldName || counter.characterName !== characterName);
                settings.updateEntryCounters.push({ worldName, characterName, lastNumber: number });
                saveSettings();
            }
            console.log(`[${MODULE_NAME}] World Info saved successfully for update: ${characterName}`);
            return true;
        } catch (error) {
            console.error(`[${MODULE_NAME}] Error creating/updating lorebook entry:`, error);
            return false;
        }
    });
}

/**
 * Processes a newly received message for character introductions
 */
async function processMessage(messageId, selectedWorldName) {
    try {
        if (settings.paused) return;
        const message = chat[messageId];

        if (!message || message.is_user || message.is_system) {
            return;
        }

        const messageContent = message.mes;

        if (!messageContent) {
            return;
        }

        const characterBlocks = detectCharacterBlocks(messageContent);

        if (characterBlocks.length === 0) {
            return;
        }

        const worldName = selectedWorldName === undefined ? getSelectedWorldInfoName() : selectedWorldName;
        if (!worldName) return;

        console.log(`[${MODULE_NAME}] Found ${characterBlocks.length} character introduction(s)`);

        const createdCharacters = [];

        for (const block of characterBlocks) {
            const characterData = parseCharacterBlock(block);

            if (characterData) {
                const success = await createLorebookEntry(
                    worldName,
                    characterData.name,
                    characterData.description
                );

                if (success) {
                    createdCharacters.push(characterData.name);
                }
            }
        }

        if (createdCharacters.length > 0) {
            console.log(`[${MODULE_NAME}] Message BEFORE edit:\n${messageContent}`);
            message.mes = removeCharacterBlocks(messageContent);
            console.log(`[${MODULE_NAME}] Message AFTER edit:\n${message.mes}`);
            updateMessageBlock(messageId, message);
            await saveChatConditional();

            const names = createdCharacters.join(', ');
            if (typeof toastr !== 'undefined') {
                toastr.success(
                    `Added lorebook entries for: ${names}`,
                    `${MODULE_NAME}`,
                    { timeOut: 5000, preventDuplicates: true }
                );
            }

            console.log(`[${MODULE_NAME}] Created entries for: ${names}`);
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error processing message:`, error);
    }
}

/**
 * Splits sibling NPC elements inside one update delimiter block.
 * Keep the single-element and legacy text paths unchanged.
 */
function splitUpdateBlock(block) {
    const content = stripBlockDelimiters(block, settings.updateStartDelimiter, settings.updateEndDelimiter);
    const tokens = /<!--[\s\S]*?-->|<(\/?)(npc_update|npc)(?=[\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>/gi;
    const elements = [];
    let opening = null;
    let openingCount = 0;
    let malformed = false;
    let end = 0;
    let remainder = '';
    for (const token of content.matchAll(tokens)) {
        if (!token[2]) continue; // Ignore tags quoted inside HTML comments.
        if (!token[1]) {
            openingCount++;
            if (opening || /\/\s*$/.test(token[3])) malformed = true;
            if (!opening) opening = { index: token.index, tag: token[2].toLowerCase() };
        } else if (opening && opening.tag === token[2].toLowerCase()) {
            remainder += content.slice(end, opening.index);
            end = token.index + token[0].length;
            elements.push(content.slice(opening.index, end));
            opening = null;
        } else {
            malformed = true;
        }
    }
    if (openingCount <= 1) return [block];
    remainder += content.slice(end);
    if (malformed || opening || remainder.trim()) {
        console.warn(`[${MODULE_NAME}] Cannot safely split update block; leaving it in the message`);
        return [];
    }
    return elements.map(content => `${settings.updateStartDelimiter}\n${content}\n${settings.updateEndDelimiter}`);
}

/**
 * Processes a newly received message for character progression updates
 */
async function processUpdates(messageId, selectedWorldName) {
    try {
        if (settings.paused) return;
        const message = chat[messageId];

        if (!message || message.is_user || message.is_system) {
            return;
        }

        const messageContent = message.mes;

        if (!messageContent) {
            return;
        }

        const updateBlocks = detectUpdateBlocks(messageContent);

        if (updateBlocks.length === 0) {
            return;
        }

        const worldName = selectedWorldName === undefined ? getSelectedWorldInfoName() : selectedWorldName;
        if (!worldName) return;

        console.log(`[${MODULE_NAME}] Found ${updateBlocks.length} character progression update(s)`);

        const updatedCharacters = [];
        let remainingMessage = messageContent;

        for (const block of updateBlocks) {
            const parts = splitUpdateBlock(block);
            const failedParts = [];
            let saved = 0;
            for (const part of parts) {
                const updateData = parseUpdateBlock(part);

                const success = updateData && await createOrUpdateLorebookEntry(
                    worldName,
                    updateData.name,
                    updateData.content
                );

                if (success) {
                    updatedCharacters.push(updateData.name);
                    saved++;
                } else {
                    failedParts.push(part);
                }
            }
            if (saved > 0) {
                if (failedParts.length) {
                    remainingMessage = remainingMessage.replace(block, () => failedParts.join('\n'));
                } else {
                    remainingMessage = remainingMessage.replace(new RegExp(`\\s*${escapeRegExp(block)}\\s*`), '').trim();
                }
            }
        }

        if (updatedCharacters.length > 0) {
            // Remove update blocks from message (same behavior as character creation)
            console.log(`[${MODULE_NAME}] Message BEFORE edit:\n${messageContent}`);
            message.mes = remainingMessage;
            console.log(`[${MODULE_NAME}] Message AFTER edit:\n${message.mes}`);
            updateMessageBlock(messageId, message);
            await saveChatConditional();

            const names = updatedCharacters.join(', ');
            if (typeof toastr !== 'undefined') {
                toastr.success(
                    `Updated lorebook entries for: ${names}`,
                    `${MODULE_NAME}`,
                    { timeOut: 5000, preventDuplicates: true }
                );
            }

            console.log(`[${MODULE_NAME}] Updated entries for: ${names}`);
            // Trigger UI refresh after all updates are done
            updateWorldInfoList();
        }
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error processing updates:`, error);
    }
}

// Set up event listener
eventSource.on(event_types.MESSAGE_RECEIVED, async (chatId, type) => {
    console.log(`[${MODULE_NAME}] MESSAGE_RECEIVED event: chatId=${chatId}, type=${type}`);
    const message = chat[chatId];
    if (!settings.paused && chatId >= 0 && message && !message.is_user && !message.is_system
        && (detectCharacterBlocks(message.mes || '').length || detectUpdateBlocks(message.mes || '').length)) {
        // Resolve once so a selection change cannot split one message across books.
        const worldName = getSelectedWorldInfoName();
        if (!worldName) return;
        await processMessage(chatId, worldName);
        if (chat[chatId] === message) await processUpdates(chatId, worldName);
    }
});

console.log(`[${MODULE_NAME}] Extension initialized successfully`);

// Export for debugging
if (typeof globalThis !== 'undefined') {
    globalThis.CharacterSaver = {
        MODULE_NAME,
        detectCharacterBlocks,
        parseCharacterBlock,
        getSelectedWorldInfoName,
        processMessage,
        detectUpdateBlocks,
        parseUpdateBlock,
        removeUpdateBlocks,
        findUpdateEntry,
        createOrUpdateLorebookEntry,
        processUpdates,
    };
}
