// Character Saver Extension for SillyTavern
// Automatically creates chat lorebook entries for characters introduced by the AI

const MODULE_NAME = 'CharacterSaver';

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
 * Reads NPC name attributes without parsing or rewriting the stored XML.
 * A non-null result also marks tag content that must survive legacy fallback.
 */
function extractNpcName(content) {
    const tags = /<(?:npc_update|npc)(?=[\s/>])((?:[^<>"']|"[^"]*"|'[^']*')*)>/gi;
    let result = null;

    for (const tag of content.matchAll(tags)) {
        result = { name: null };
        // Consume complete attributes so a quoted value containing `name=`
        // cannot be mistaken for the actual name attribute.
        const attributes = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
        for (const attribute of tag[1].matchAll(attributes)) {
            if (attribute[1].toLowerCase() !== 'name') continue;
            const name = (attribute[2] ?? attribute[3] ?? '').trim();
            if (name) return { name };
        }
    }

    return result;
}

/**
 * Parses a character block to extract name and description
 */
function parseCharacterBlock(block) {
    try {
        let content = block
            .replace(new RegExp(escapeRegExp(START_DELIMITER()), 'gi'), '')
            .replace(new RegExp(escapeRegExp(END_DELIMITER()), 'gi'), '')
            .trim();

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
        let content = block
            .replace(new RegExp(escapeRegExp(settings.updateStartDelimiter), 'gi'), '')
            .replace(new RegExp(escapeRegExp(settings.updateEndDelimiter), 'gi'), '')
            .trim();

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

        const characterBlocks = detectCharacterBlocks(messageContent);

        if (characterBlocks.length === 0) {
            return;
        }

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

        const updateBlocks = detectUpdateBlocks(messageContent);

        if (updateBlocks.length === 0) {
            return;
        }

        console.log(`[${MODULE_NAME}] Found ${updateBlocks.length} character progression update(s)`);

        const updatedCharacters = [];

        for (const block of updateBlocks) {
            const updateData = parseUpdateBlock(block);

            if (updateData) {
                const success = await createOrUpdateLorebookEntry(
                    worldName,
                    updateData.name,
                    updateData.content
                );

                if (success) {
                    updatedCharacters.push(updateData.name);
                }
            }
        }

        if (updatedCharacters.length > 0) {
            // Remove update blocks from message (same behavior as character creation)
            console.log(`[${MODULE_NAME}] Message BEFORE edit:\n${messageContent}`);
            message.mes = removeUpdateBlocks(messageContent);
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
