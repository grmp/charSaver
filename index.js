// Character Saver Extension for SillyTavern
// Automatically creates chat lorebook entries for characters introduced by the AI

const MODULE_NAME = 'CharacterSaver';

import {
    detectBlockRanges,
    parseBlock,
    removeRanges,
} from './parser.js';

// Default settings
const defaultSettings = {
    // Character creation settings
    startDelimiter: '<!-- new character start',
    endDelimiter: 'new character end -->',

    // Character update settings
    updateStartDelimiter: '<!-- update character start',
    updateEndDelimiter: 'update character end -->',
};

// Current settings (will be loaded from extension_settings)
let settings = { ...defaultSettings };

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
    METADATA_KEY,
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
                    <li><b>Character Updates:</b> Creates or appends to a "Update for [Name]" entry for character progression</li>
                    <li>Names may use legacy Name/bold syntax or an <code>&lt;npc name="..."&gt;</code> / <code>&lt;npc_update name="..."&gt;</code> tag</li>
                    <li>Tags work inside configured delimiter blocks; standalone paired tags require a closing tag. Self-closing tags are also supported.</li>
                    <li>Successfully processed delimiter or tag blocks are removed from messages</li>
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

// Re-render settings when extension settings menu is opened
eventSource.on(event_types.CHAT_CHANGED, async () => {
    const container = document.querySelector('#extensions_settings #char-saver-settings');
    if (container && container.offsetParent !== null) {
        await renderSettings();
    }
});

const characterDelimiters = () => ({ start: START_DELIMITER(), end: END_DELIMITER() });
const updateDelimiters = () => ({ start: settings.updateStartDelimiter, end: settings.updateEndDelimiter });

/**
 * Detects all character introduction blocks in a message
 */
function detectCharacterBlocks(messageContent) {
    return detectBlockRanges(messageContent, 'character', characterDelimiters()).map(block => block.text);
}

/**
 * Detects all character progression update blocks in a message
 */
function detectUpdateBlocks(messageContent) {
    return detectBlockRanges(messageContent, 'update', updateDelimiters()).map(block => block.text);
}

/**
 * Parses a character block to extract name and description
 */
function parseCharacterBlock(block) {
    try {
        const character = parseBlock(block, 'character', characterDelimiters());
        if (!character) {
            console.warn(`[${MODULE_NAME}] Could not extract character name from block`);
            return null;
        }
        return character;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error parsing character block:`, error);
        return null;
    }
}

/**
 * Removes character progression update blocks from a message
 */
function removeUpdateBlocks(messageContent, ranges = null) {
    const blocks = ranges ?? detectBlockRanges(messageContent, 'update', updateDelimiters())
        .filter(block => parseUpdateBlock(block.text));
    return removeRanges(messageContent, blocks);
}

/**
 * Removes character introduction blocks from a message
 */
function removeCharacterBlocks(messageContent, ranges = null) {
    const blocks = ranges ?? detectBlockRanges(messageContent, 'character', characterDelimiters())
        .filter(block => parseCharacterBlock(block.text));
    return removeRanges(messageContent, blocks);
}

/**
 * Parses a character progression update block to extract name and content
 */
function parseUpdateBlock(block) {
    try {
        const update = parseBlock(block, 'update', updateDelimiters());
        if (!update) {
            console.warn(`[${MODULE_NAME}] Could not extract character name from update block`);
            return null;
        }
        return update;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error parsing update block:`, error);
        return null;
    }
}

/**
 * Gets or creates the current chat's World Info name
 */
async function getOrCreateWorldInfoName() {
    let worldName = chat_metadata[METADATA_KEY];

    console.log(`[${MODULE_NAME}] Detected World Info name: '${worldName}'`);
    console.log(`[${MODULE_NAME}] Available World Info books:`, world_names);
    console.log(`[${MODULE_NAME}] Full chat_metadata:`, chat_metadata);

    // Check if World Info exists and is valid
    if (worldName && world_names.includes(worldName)) {
        return worldName;
    }

    // No World Info exists - ask user if they want to create one
    console.log(`[${MODULE_NAME}] No World Info found. Asking user...`);

    const confirm = await callGenericPopup(
        'No lorebook is attached to this chat. Would you like to create one to save the character?',
        POPUP_TYPE.CONFIRM,
        '',
        { okButton: 'Create Lorebook' }
    );

    if (!confirm) {
        console.log(`[${MODULE_NAME}] User cancelled lorebook creation`);
        return null;
    }

    // Generate a name for the new World Info using the character name
    const characterName = name2 || 'Chat';
    // Format: YYYY-MM-DD HH:MM (example: 2026-06-02 14:30)
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 5); // HH:MM
    const newWorldName = `${characterName} Chat Lorebook ${dateStr} ${timeStr}`;

    try {
        // Create the new World Info (this also calls updateWorldInfoList internally)
        await createNewWorldInfo(newWorldName, { interactive: false });

        console.log(`[${MODULE_NAME}] Created new World Info: '${newWorldName}'`);

        // Update the chat metadata to use the new World Info
        chat_metadata[METADATA_KEY] = newWorldName;

        console.log(`[${MODULE_NAME}] Set chat_metadata[${METADATA_KEY}] = '${newWorldName}'`);

        // Save the metadata
        await saveMetadata();

        console.log(`[${MODULE_NAME}] Metadata saved. Current chat_metadata[METADATA_KEY]:`, chat_metadata[METADATA_KEY]);

        // Wait a bit for the UI to update, then check if the lorebook is in the list
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if the lorebook is in world_names; if not, manually add it
        let hasWorldInfo = world_names.includes(newWorldName);
        if (!hasWorldInfo) {
            console.warn(`[${MODULE_NAME}] Lorebook not found in world_names, manually adding it`);
            world_names.push(newWorldName);
            hasWorldInfo = true;
        }

        // Update the UI to show that a lorebook is attached
        const chatLorebookButton = document.querySelector('.chat_lorebook_button');
        if (chatLorebookButton) {
            if (hasWorldInfo) {
                chatLorebookButton.classList.add('world_set');
                console.log(`[${MODULE_NAME}] Updated UI button state (world_set=true)`);
            } else {
                console.warn(`[${MODULE_NAME}] Lorebook still not found in world_names after manual add`);
                console.log(`[${MODULE_NAME}] Current world_names:`, world_names);
            }
        } else {
            console.warn(`[${MODULE_NAME}] Chat lorebook button not found`);
        }

        return newWorldName;
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
async function createLorebookEntry(worldName, characterName, description) {
    try {
        console.log(`[${MODULE_NAME}] Creating entry for '${characterName}' in World Info: '${worldName}'`);

        const worldData = await loadWorldInfo(worldName);

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
        newEntry.order = 100;
        newEntry.constant = false;
        newEntry.selective = false;
        newEntry.depth = 4;
        newEntry.probability = 100;
        newEntry.position = 0;
        newEntry.vectorized = true;

        console.log(`[${MODULE_NAME}] Saving World Info with`, Object.keys(worldData.entries || {}).length, 'entries');

        await saveWorldInfo(worldName, worldData, true);

        console.log(`[${MODULE_NAME}] World Info saved successfully for: ${characterName}`);
        return true;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error creating lorebook entry:`, error);
        return false;
    }
}

/**
 * Creates a new update entry or appends to an existing one
 */
async function createOrUpdateLorebookEntry(worldName, characterName, updateContent) {
    try {
        console.log(`[${MODULE_NAME}] Creating/updating entry for '${characterName}' in World Info: '${worldName}'`);

        const worldData = await loadWorldInfo(worldName);

        if (!worldData) {
            console.error(`[${MODULE_NAME}] Failed to load World Info: ${worldName}`);
            return false;
        }

        const existingEntry = findUpdateEntry(worldData, characterName);

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
            newEntry.comment = `Update for ${characterName}`;
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
        console.log(`[${MODULE_NAME}] World Info saved successfully for update: ${characterName}`);
        return true;
    } catch (error) {
        console.error(`[${MODULE_NAME}] Error creating/updating lorebook entry:`, error);
        return false;
    }
}

/**
 * Processes a newly received message for character introductions
 */
async function processMessage(messageId) {
    try {
        const message = chat[messageId];

        if (!message || message.is_user || message.is_system) {
            return;
        }

        const messageContent = message.mes;

        if (!messageContent) {
            return;
        }

        const worldName = await getOrCreateWorldInfoName();

        if (!worldName) {
            console.warn(`[${MODULE_NAME}] Could not get or create World Info`);
            return;
        }

        const characterBlocks = detectBlockRanges(messageContent, 'character', characterDelimiters());

        if (characterBlocks.length === 0) {
            return;
        }

        console.log(`[${MODULE_NAME}] Found ${characterBlocks.length} character introduction(s)`);

        const createdCharacters = [];
        const processedBlocks = [];

        for (const block of characterBlocks) {
            const characterData = parseCharacterBlock(block.text);

            if (characterData) {
                const success = await createLorebookEntry(
                    worldName,
                    characterData.name,
                    characterData.description
                );

                if (success) {
                    createdCharacters.push(characterData.name);
                    processedBlocks.push(block);
                }
            }
        }

        if (createdCharacters.length > 0) {
            console.log(`[${MODULE_NAME}] Message BEFORE edit:\n${messageContent}`);
            message.mes = removeCharacterBlocks(messageContent, processedBlocks);
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
 * Processes a newly received message for character progression updates
 */
async function processUpdates(messageId) {
    try {
        const message = chat[messageId];

        if (!message || message.is_user || message.is_system) {
            return;
        }

        const messageContent = message.mes;

        if (!messageContent) {
            return;
        }

        const worldName = await getOrCreateWorldInfoName();

        if (!worldName) {
            console.warn(`[${MODULE_NAME}] Could not get or create World Info for updates`);
            return;
        }

        const updateBlocks = detectBlockRanges(messageContent, 'update', updateDelimiters());

        if (updateBlocks.length === 0) {
            return;
        }

        console.log(`[${MODULE_NAME}] Found ${updateBlocks.length} character progression update(s)`);

        const updatedCharacters = [];
        const processedBlocks = [];

        for (const block of updateBlocks) {
            const updateData = parseUpdateBlock(block.text);

            if (updateData) {
                const success = await createOrUpdateLorebookEntry(
                    worldName,
                    updateData.name,
                    updateData.content
                );

                if (success) {
                    updatedCharacters.push(updateData.name);
                    processedBlocks.push(block);
                }
            }
        }

        if (updatedCharacters.length > 0) {
            // Remove update blocks from message (same behavior as character creation)
            console.log(`[${MODULE_NAME}] Message BEFORE edit:\n${messageContent}`);
            message.mes = removeUpdateBlocks(messageContent, processedBlocks);
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
        await processMessage(chatId);       // Character creation (removes blocks)
        await processUpdates(chatId);        // Character updates (removes blocks)
    }
});

console.log(`[${MODULE_NAME}] Extension initialized successfully`);

// Export for debugging
if (typeof globalThis !== 'undefined') {
    globalThis.CharacterSaver = {
        MODULE_NAME,
        detectCharacterBlocks,
        parseCharacterBlock,
        removeCharacterBlocks,
        getOrCreateWorldInfoName,
        processMessage,
        detectUpdateBlocks,
        parseUpdateBlock,
        removeUpdateBlocks,
        findUpdateEntry,
        createOrUpdateLorebookEntry,
        processUpdates,
    };
}
