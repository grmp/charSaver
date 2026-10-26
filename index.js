// Character Saver Extension for SillyTavern
// Automatically creates chat lorebook entries for characters introduced by the AI

const MODULE_NAME = 'CharacterSaver';

// Chat metadata key storing the lorebook selected for the current chat
const CHAR_SAVER_WORLD_METADATA_KEY = 'characterSaverWorld';

// Default settings
const defaultSettings = {
    // Character creation settings
    startDelimiter: '<!-- new character start',
    endDelimiter: 'new character end -->',

    // Character update settings
    updateStartDelimiter: '<!-- update character start',
    updateEndDelimiter: 'update character end -->',
    separateUpdateEntries: false,
    updateEntryCounters: [],

    // Lorebook settings
    lorebookScope: 'chat',
    characterLorebooks: {},
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
    characters,
    this_chid,
    saveSettingsDebounced,
} from '../../../../script.js';

import {
    METADATA_KEY,
    world_names,
    loadWorldInfo,
    createWorldInfoEntry,
    saveWorldInfo,
    createNewWorldInfo,
    deleteWorldInfo,
    updateWorldInfoList,
} from '../../../../scripts/world-info.js';

import {
    eventSource,
    event_types,
} from '../../../../scripts/events.js';

import {
    extension_settings,
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
                <label class="checkbox_label" for="char_saver_paused_for_chat">
                    <input id="char_saver_paused_for_chat" type="checkbox">
                    <span>Pause for this Chat</span>
                </label>
                <small>Stops new and pending processing in this chat. Unsaved delimiter blocks stay in the messages. A save already in progress may finish.</small>
            </div>

            <hr class="sysHR">

            <div class="marginBot5">
                <label>Lorebook</label>
                <div class="marginBot5">
                    <label for="char_saver_lorebook_scope">Lorebook Setting valid for</label>
                    <select id="char_saver_lorebook_scope" class="text_pole">
                        <option value="chat">This Chat</option>
                        <option value="character">This Character</option>
                    </select>
                    <small>"This Chat": the lorebook setting applies to the current chat only. "This Character": the setting applies to all chats of the current character.</small>
                </div>
                <div class="marginBot5">
                    <label for="char_saver_lorebook_select">Lorebook</label>
                    <select id="char_saver_lorebook_select" class="text_pole"></select>
                    <small>Select the lorebook where characters are saved. "(not set)" asks before creating a new lorebook when a character is introduced.</small>
                </div>
                <div class="marginBot5">
                    <label for="char_saver_new_lorebook_name">Create New Lorebook</label>
                    <input id="char_saver_new_lorebook_name" class="text_pole" type="text" placeholder="My Lorebook">
                    <small>Creates a new lorebook with this name and selects it. Names must not contain ":".</small>
                </div>
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
                    Character Saver automatically creates chat lorebook entries for characters introduced by the AI:
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

    // Get input elements
    const startInput = document.getElementById('char_saver_start_delimiter');
    const endInput = document.getElementById('char_saver_end_delimiter');
    const updateStartInput = document.getElementById('char_saver_update_start_delimiter');
    const updateEndInput = document.getElementById('char_saver_update_end_delimiter');
    const separateUpdatesInput = document.getElementById('char_saver_separate_update_entries');
    const pausedForChatInput = document.getElementById('char_saver_paused_for_chat');
    const lorebookScopeInput = document.getElementById('char_saver_lorebook_scope');
    const lorebookSelectInput = document.getElementById('char_saver_lorebook_select');
    const newLorebookNameInput = document.getElementById('char_saver_new_lorebook_name');

    if (lorebookScopeInput) {
        lorebookScopeInput.value = settings.lorebookScope === 'character' ? 'character' : 'chat';
        lorebookScopeInput.addEventListener('change', () => {
            settings.lorebookScope = lorebookScopeInput.value === 'character' ? 'character' : 'chat';
            saveSettings();
            activateConfiguredLorebook();
            refreshLorebookSelect(lorebookSelectInput);
        });
    }

    if (lorebookSelectInput) {
        refreshLorebookSelect(lorebookSelectInput);
        lorebookSelectInput.addEventListener('change', () => {
            const worldName = lorebookSelectInput.value || null;
            setConfiguredLorebookName(worldName);
            if (worldName) console.log(`[${MODULE_NAME}] Lorebook set to: '${worldName}'`);
        });
    }

    if (newLorebookNameInput) {
        newLorebookNameInput.value = '';
        newLorebookNameInput.addEventListener('change', async () => {
            const created = await createLorebookFromInput(newLorebookNameInput.value);
            if (created) {
                newLorebookNameInput.value = '';
                refreshLorebookSelect(lorebookSelectInput);
            }
        });
    }

    if (pausedForChatInput) {
        pausedForChatInput.checked = isPausedForChat();
        pausedForChatInput.addEventListener('change', () => {
            setPausedForChat(pausedForChatInput.checked);
        });
    }

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

const PAUSE_METADATA_KEY = 'characterSaverPaused';
let pauseGeneration = 0;
let chatGeneration = 0;

/**
 * Keep pending work tied to its original chat and pause state.
 * Unpausing allows new work without reviving cancelled work.
 */
function createProcessingContext() {
    const metadata = chat_metadata;
    const currentChatGeneration = chatGeneration;
    const currentPauseGeneration = pauseGeneration;
    const isCurrentChat = () => metadata === chat_metadata && currentChatGeneration === chatGeneration;
    return {
        isCurrentChat,
        canProcess: () => isCurrentChat() && currentPauseGeneration === pauseGeneration && !isPausedForChat(),
    };
}

/**
 * Returns whether the extension is paused for the current chat
 */
function isPausedForChat() {
    return chat_metadata?.[PAUSE_METADATA_KEY] === true;
}

/**
 * Persists the pause state for the current chat
 */
function setPausedForChat(paused) {
    if (!chat_metadata) return;
    if (paused) {
        pauseGeneration++;
        chat_metadata[PAUSE_METADATA_KEY] = true;
    } else {
        delete chat_metadata[PAUSE_METADATA_KEY];
    }
    saveMetadata();
    console.log(`[${MODULE_NAME}] Pause for this chat: ${paused}`);
}

// Initialize settings
loadSettings();

// Add settings button to extensions menu
eventSource.on(event_types.APP_READY, async () => {
    activateConfiguredLorebook();
    const extensionsMenu = document.getElementById('extensions_settings');
    if (extensionsMenu) {
        const settingsButton = document.createElement('div');
        settingsButton.id = 'char-saver-settings';
        extensionsMenu.appendChild(settingsButton);
        await renderSettings();
    }
});

// Refresh chat-specific settings even when the extensions drawer is closed.
eventSource.on(event_types.CHAT_CHANGED, async () => {
    chatGeneration++;
    activateConfiguredLorebook();
    const container = document.querySelector('#extensions_settings #char-saver-settings');
    if (container) {
        await renderSettings();
    }
});

/**
 * Escapes text for safe use in option values and labels
 */
function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

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


/**
 * Builds a valid lorebook name. ":" is not allowed in lorebook names.
 */
function sanitizeWorldName(rawName) {
    const sanitized = String(rawName || '').replace(/[\r\n\t:]/g, ' ').replace(/\s+/g, ' ').trim();
    return sanitized || null;
}

/**
 * The card filename remains stable across display-name changes and is unique
 * even when multiple cards have the same name.
 */
function getCharacterScopeKey() {
    const avatar = characters[this_chid]?.avatar;
    return avatar ? `avatar:${avatar}` : '';
}

/**
 * Returns the lorebook name configured for the current chat or character.
 */
function getConfiguredLorebookName() {
    const scope = settings.lorebookScope === 'character' ? 'character' : 'chat';
    if (scope === 'chat') {
        // Existing chats used the native SillyTavern assignment before the
        // extension introduced its own selection. Keep that assignment usable.
        return chat_metadata?.[CHAR_SAVER_WORLD_METADATA_KEY] || chat_metadata?.[METADATA_KEY] || null;
    }

    const key = getCharacterScopeKey();
    if (!key) return null;
    const books = settings.characterLorebooks || {};
    if (Object.hasOwn(books, key)) return books[key] || null;

    // Only migrate a name-based setting when it identifies exactly one card.
    // Ambiguous legacy names must never leak a choice to another character.
    const characterName = characters[this_chid]?.name;
    if (characterName && Object.hasOwn(books, characterName)
        && characters.filter(character => character.name === characterName).length === 1) {
        settings.characterLorebooks = { ...books, [key]: books[characterName] };
        delete settings.characterLorebooks[characterName];
        saveSettings();
        return settings.characterLorebooks[key] || null;
    }
    return null;
}

/**
 * Attach the selected book through the native metadata key so its entries are
 * included in prompt generation. Returns whether metadata changed.
 */
function syncChatLorebook(worldName) {
    if (!chat_metadata || (worldName && !world_names.includes(worldName))) return false;
    const previous = chat_metadata[METADATA_KEY] || null;
    if (worldName) chat_metadata[METADATA_KEY] = worldName;
    else delete chat_metadata[METADATA_KEY];
    document.querySelector('.chat_lorebook_button')?.classList?.toggle('world_set', !!worldName);
    return previous !== worldName;
}

function activateConfiguredLorebook() {
    const worldName = getConfiguredLorebookName();
    if (worldName && syncChatLorebook(worldName)) saveMetadata();
}

/**
 * An asynchronous creation must still belong to the same chat, card, scope and
 * selection when it completes. Pausing alone does not discard a created book.
 */
function createLorebookSelectionContext() {
    const processing = createProcessingContext();
    const scope = settings.lorebookScope;
    const characterKey = getCharacterScopeKey();
    const worldName = getConfiguredLorebookName();
    return {
        isCurrent: () => processing.isCurrentChat()
            && scope === settings.lorebookScope
            && (scope !== 'character' || !!characterKey)
            && characterKey === getCharacterScopeKey()
            && worldName === getConfiguredLorebookName(),
    };
}

/**
 * Stores the lorebook name for the current chat or character.
 */
function setConfiguredLorebookName(worldName) {
    if (worldName && !world_names.includes(worldName)) return;
    const scope = settings.lorebookScope === 'character' ? 'character' : 'chat';
    if (scope === 'character') {
        const key = getCharacterScopeKey();
        if (!key) return;
        getConfiguredLorebookName(); // Migrate an unambiguous legacy choice before replacing or clearing it.
        settings.characterLorebooks = { ...(settings.characterLorebooks || {}) };
        if (worldName) settings.characterLorebooks[key] = worldName;
        else delete settings.characterLorebooks[key];
        saveSettings();
    } else {
        if (!chat_metadata) return;
        if (worldName) chat_metadata[CHAR_SAVER_WORLD_METADATA_KEY] = worldName;
        else delete chat_metadata[CHAR_SAVER_WORLD_METADATA_KEY];
    }
    const nativeChanged = syncChatLorebook(worldName);
    if (scope === 'chat' || nativeChanged) saveMetadata();
}

/**
 * Roll back only a newly created, empty book if its original target changed.
 * Preserve a book edited in the meantime, and report a failed cleanup.
 */
async function discardCreatedLorebook(worldName) {
    try {
        const data = await loadWorldInfo(worldName);
        if (data && Object.keys(data.entries || {}).length === 0 && await deleteWorldInfo(worldName)) return;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to clean up cancelled lorebook:`, error);
    }
    if (typeof toastr !== 'undefined') {
        toastr.warning(`The target changed while creating "${worldName}". The book was kept; select or remove it manually.`, MODULE_NAME);
    }
}

async function createAndSelectLorebook(worldName, selection) {
    if (!selection.isCurrent()) return null;
    const created = await createNewWorldInfo(worldName, { interactive: false });
    if (created !== true) return null;
    if (!selection.isCurrent()) {
        await discardCreatedLorebook(worldName);
        return null;
    }
    setConfiguredLorebookName(worldName);
    return worldName;
}

/**
 * Creates a new lorebook from the settings input and selects it for the current scope.
 */
async function createLorebookFromInput(rawName) {
    const selection = createLorebookSelectionContext();
    const worldName = sanitizeWorldName(rawName);
    if (!worldName) {
        if (typeof toastr !== 'undefined') {
            toastr.warning('Please enter a valid lorebook name. ":" is not allowed.', `${MODULE_NAME}`);
        }
        return null;
    }
    if (world_names.includes(worldName)) {
        if (typeof toastr !== 'undefined') {
            toastr.warning(`A lorebook named "${worldName}" already exists.`, `${MODULE_NAME}`);
        }
        setConfiguredLorebookName(worldName);
        return worldName;
    }
    try {
        const created = await createAndSelectLorebook(worldName, selection);
        if (!created) return null;
        if (typeof toastr !== 'undefined') {
            toastr.success(`Created lorebook "${worldName}"`, `${MODULE_NAME}`);
        }
        return worldName;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to create lorebook:`, error);
        if (typeof toastr !== 'undefined') {
            toastr.error(`Failed to create lorebook "${worldName}"`, `${MODULE_NAME}`);
        }
        return null;
    }
}

/**
 * Populates the lorebook dropdown with "(not set)" plus all known lorebooks.
 */
function refreshLorebookSelect(select) {
    if (!select) return;
    const current = getConfiguredLorebookName();
    const options = ['<option value="">(not set)</option>']
        .concat(world_names.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`));
    select.innerHTML = options.join('');
    select.value = current && world_names.includes(current) ? current : '';
}

/**
 * Gets or creates the lorebook used for saving characters.
 */
async function getOrCreateWorldInfoName(processing = createProcessingContext()) {
    if (!processing.canProcess()) return null;

    const configuredWorldName = getConfiguredLorebookName();
    if (configuredWorldName && world_names.includes(configuredWorldName)) {
        activateConfiguredLorebook();
        return configuredWorldName;
    }

    const selection = createLorebookSelectionContext();

    // No lorebook configured - ask user if they want to create one
    console.log(`[${MODULE_NAME}] No lorebook configured. Asking user...`);

    const confirm = await callGenericPopup(
        'No lorebook is set for this chat/character. Would you like to create one to save the character?',
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Create Lorebook' }
    );

    if (!processing.canProcess() || !selection.isCurrent()) return null;

    if (!confirm) {
        console.log(`[${MODULE_NAME}] User cancelled lorebook creation`);
        return null;
    }

    // Generate a name for the new lorebook using the character name
    const characterName = name2 || 'Chat';
    // Format: YYYY-MM-DD HH:MM (example: 2026-06-02 14:30)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5); // HH:MM
    const newWorldName = sanitizeWorldName(`${characterName} Chat Lorebook ${dateStr} ${timeStr}`);
    if (!newWorldName) {
        console.error(`[${MODULE_NAME}] Could not build a valid lorebook name`);
        return null;
    }

    try {
        const created = await createAndSelectLorebook(newWorldName, selection);
        // A completed creation stays selected when paused, while entry writes
        // and delimiter cleanup remain cancelled by the processing context.
        return processing.canProcess() ? created : null;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to create World Info:`, error);
        return null;
    }
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
async function createLorebookEntry(worldName, characterName, description, processing = createProcessingContext()) {
    return queueWorldWrite(worldName, async () => {
        try {
            if (!processing.canProcess()) return false;
            console.log(`[${MODULE_NAME}] Creating entry for '${characterName}' in World Info: '${worldName}'`);

            const worldData = structuredClone(await loadWorldInfo(worldName));

            if (!processing.canProcess()) return false;

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
async function createOrUpdateLorebookEntry(worldName, characterName, updateContent, processing = createProcessingContext()) {
    const separateUpdates = settings.separateUpdateEntries === true;
    return queueWorldWrite(worldName, async () => {
        try {
            if (!processing.canProcess()) return false;
            console.log(`[${MODULE_NAME}] Creating/updating entry for '${characterName}' in World Info: '${worldName}'`);

            const worldData = structuredClone(await loadWorldInfo(worldName));

            if (!processing.canProcess()) return false;

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
async function processMessage(messageId, processing = createProcessingContext()) {
    try {
        if (!processing.canProcess()) {
            console.log(`[${MODULE_NAME}] Paused for this chat, skipping message processing`);
            return;
        }

        const message = chat[messageId];

        if (!message || message.is_user || message.is_system) {
            return;
        }

        const messageContent = message.mes;

        if (!messageContent) {
            return;
        }

        const worldName = await getOrCreateWorldInfoName(processing);

        if (!processing.canProcess()) return;

        if (!worldName) {
            console.warn(`[${MODULE_NAME}] Could not get or create World Info`);
            return;
        }

        const characterBlocks = detectCharacterBlocks(messageContent);

        if (characterBlocks.length === 0) {
            return;
        }

        console.log(`[${MODULE_NAME}] Found ${characterBlocks.length} character introduction(s)`);

        const createdCharacters = [];
        let remainingMessage = messageContent;

        for (const block of characterBlocks) {
            if (!processing.canProcess()) break;
            const characterData = parseCharacterBlock(block);

            if (characterData) {
                const success = await createLorebookEntry(
                    worldName,
                    characterData.name,
                    characterData.description,
                    processing
                );

                if (success) {
                    createdCharacters.push(characterData.name);
                    remainingMessage = remainingMessage.replace(new RegExp(`\\s*${escapeRegExp(block)}\\s*`), '').trim();
                }
            }
        }

        // Finish cleanup for completed saves, retaining any unsaved blocks for retry.
        if (createdCharacters.length > 0 && processing.isCurrentChat()) {
            console.log(`[${MODULE_NAME}] Message BEFORE edit:\n${messageContent}`);
            message.mes = remainingMessage;
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
async function processUpdates(messageId, processing = createProcessingContext()) {
    try {
        if (!processing.canProcess()) {
            console.log(`[${MODULE_NAME}] Paused for this chat, skipping update processing`);
            return;
        }

        const message = chat[messageId];

        if (!message || message.is_user || message.is_system) {
            return;
        }

        const messageContent = message.mes;

        if (!messageContent) {
            return;
        }

        const worldName = await getOrCreateWorldInfoName(processing);

        if (!processing.canProcess()) return;

        if (!worldName) {
            console.warn(`[${MODULE_NAME}] Could not get or create World Info for updates`);
            return;
        }

        const updateBlocks = detectUpdateBlocks(messageContent);

        if (updateBlocks.length === 0) {
            return;
        }

        console.log(`[${MODULE_NAME}] Found ${updateBlocks.length} character progression update(s)`);

        const updatedCharacters = [];
        let remainingMessage = messageContent;

        for (const block of updateBlocks) {
            const parts = splitUpdateBlock(block);
            const failedParts = [];
            let saved = 0;
            for (const part of parts) {
                const updateData = parseUpdateBlock(part);

                const success = processing.canProcess() && updateData && await createOrUpdateLorebookEntry(
                    worldName,
                    updateData.name,
                    updateData.content,
                    processing
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

        // A save already sent may finish after pausing; remove only its saved parts.
        if (updatedCharacters.length > 0 && processing.isCurrentChat()) {
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
    if (chatId >= 0 && chat[chatId] && !chat[chatId].is_user) {
        const processing = createProcessingContext();
        await processMessage(chatId, processing);       // Character creation (removes blocks)
        await processUpdates(chatId, processing);        // Character updates (removes blocks)
    }
});

console.log(`[${MODULE_NAME}] Extension initialized successfully`);

// Export for debugging
if (typeof globalThis !== 'undefined') {
    globalThis.CharacterSaver = {
        MODULE_NAME,
        detectCharacterBlocks,
        parseCharacterBlock,
        getOrCreateWorldInfoName,
        processMessage,
        detectUpdateBlocks,
        parseUpdateBlock,
        removeUpdateBlocks,
        findUpdateEntry,
        isPausedForChat,
        setPausedForChat,
        sanitizeWorldName,
        getConfiguredLorebookName,
        setConfiguredLorebookName,
        createLorebookFromInput,
        refreshLorebookSelect,
        createOrUpdateLorebookEntry,
        processUpdates,
    };
}
