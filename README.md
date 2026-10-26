# Character Saver - SillyTavern Extension

A SillyTavern extension that saves AI character introductions and updates to a lorebook selected for the current chat or character.

## Features

- **Character Creation**: Automatically detects character introductions in AI responses and creates entries in the selected lorebook
- **All NPC**: Appends each new character's XML attributes to a shared "All NPC" lorebook entry, one character per line
- **Character Updates**: Detects character progression/updates and either appends to "Update for [Name]" or creates separate numbered entries
- Removes character introduction and update blocks from the chat after processing
- Supports multiple character introductions/updates in a single message
- Supports flexible character name formats:
  - `**Name:** John Doe`
  - `Name: John Doe`
  - `**John Doe**`
  - `<npc name="John Doe">...</npc>` and `<npc_update name="John Doe">...</npc_update>` inside the configured delimiters
- Select an existing lorebook or create one in Settings, directly below **Pause**
- Save independent lorebook selections for a chat or a character
- Shows toast notifications when characters are added or updated

## Installation

1. In SillyTavern, go to **Extensions → Manage Extensions**
2. Click the **Install from URL** button
3. Paste this URL: `https://github.com/hornysilicon/charSaver`
4. Click **Install**
5. Enable the extension in the extensions list

## Setup

Open a chat, then go to **Extensions → Character Saver**. Below **Pause**, choose **Chat** or **Character** scope and select a lorebook, or click **Create Lorebook**. Character creation, **All NPC**, and updates all use this selected book. The lorebook already bound to the chat is not used automatically or changed.

Then instruct the AI to use the special delimiters when introducing or updating characters.

### Adding to Your System Prompt

Add this to your system prompt or global preset:

```
When introducing new NPCs, provide a quick full description between `<!-- new character start` and `new character end -->`. The description must include the character's Name.

When updating existing NPCs with new information, place the update between `<!-- update character start` and `update character end -->`. Include the character's Name.

Example format for new characters:
<!-- new character start
Name: John Doe
**Physical description:** Tall, lean, with short brown hair and blue eyes.
**Mannerisms:** Speaks slowly, taps his fingers when thinking.
-->

Example format for character updates:
<!-- update character start
Name: John Doe
**Status update:** John has been promoted to Captain.
**New equipment:** Now wears a ceremonial sword.
-->
```

### Adding to Character Cards

You can also add this directly to your character card's "System Prompt" field or personality section.

## Character Introduction Format

The extension supports flexible formats. Here are examples that will all work:

### Format 1: With field labels
```
<!-- new character start
Name: Verena Cortez
Physical description: Early 30s, 170cm, lean build. Dark brown skin, close-cropped hair.
Mannerisms: Speaks precisely, rarely blinks.
-->
```

### Format 2: Bolded field labels
```
<!-- new character start
**Name:** Danny Pham
**Physical description:** Late 20s, round face, short black hair.
**Occupation:** Junior financial analyst.
-->
```

### Format 3: Just a bolded name
```
<!-- new character start
**Marcus Doyle**
A large security supervisor in his late 30s with a shaved head and a noticeable limp.
-->
```

## Character Update Format

When updating existing characters, use the update delimiters:

```
<!-- update character start
Name: Verena Cortez
**Recent events:** Verena has been injured during the mission.
**Status change:** Currently recovering in the medical bay.
-->
```

By default, new content is appended to an existing "Update for [Name]" entry, or that entry is created if missing.

Enable **Save each update as a separate entry** under **Extensions → Character Saver → Character Updates** to create "Update [Name] #1", "Update [Name] #2", etc. Each update block becomes its own entry. Numbers increase independently for each exact character name in each lorebook.

The last number is saved in the extension settings, so deleting entries does not reuse their numbers. Existing numbered entries are also checked when choosing the next number. Keep these settings when moving installations to preserve deleted entries' number history; lorebook renames are treated as a new counter scope.

Switching modes affects future updates only: existing entries are not renamed, split, or merged. Switching back to separate entries resumes numbering. This setting applies globally across chats.

New numbered entries use `Update [Name] #Number`. Existing `Update #Number for [Name]` titles remain unchanged and still count toward the next number.

The outer delimiters determine whether content creates a `Character: [Name]` entry or an update. An `<npc_update>` tag inside the character introduction delimiters still creates a character entry; there is no fallback from failed updates to character creation. Keep introduction and update delimiters distinct.

## NPC XML Tags

An update delimiter block may contain several complete sibling `<npc_update>` (or `<npc>`) elements. Each element is saved for its own character, using the selected append or numbered-entry mode. Keep only whitespace between sibling elements. Ambiguous or malformed groups remain in the message; if an individual save fails, only the unsaved elements remain for retry. Standalone tags still require the configured outer delimiters.

Names may also be supplied through the `name` attribute of an `npc` or
`npc_update` tag. The existing comment delimiters are still required and determine
whether to create a character entry or an update. Tags outside those delimiters
do not trigger processing.

```xml
<!-- new character start
<npc role="captain" name="María O'Connell">
Tall, observant, and habitually carries a brass compass.
</npc>
new character end -->
```

```xml
<!-- update character start
<npc_update timestamp="2026-09-24" name="María O'Connell" location="Harbor">
Promoted to admiral.
</npc_update>
update character end -->
```

Additional attributes may appear in any order. Single or double quotes,
whitespace around `=`, multiline attributes, and different capitalization of
tag and attribute names are supported. A nonempty `name` attribute takes priority
over any Name line or bolded name in the block; otherwise the existing name
formats are tried.

The complete content inside the delimiters is retained for XML blocks, including
opening and closing tags, attributes, and internal formatting. Only the surrounding
delimiters and outer whitespace are removed. Existing updates are appended as before.

Each new character is also appended to the selected lorebook's **All NPC** entry, which
is created automatically if missing. New entries use Constant activation with
Vectorized disabled and order 98. All opening-tag attributes are included in their
original order as comma-separated `attribute=value` pairs, without quotes.
For example, `<npc name="Test" color="#fffff" sex="male">` adds:

```text
Known NPC=
name=Test, color=#fffff, sex=male
```

The entry always begins with `Known NPC=` on its own line. The prefix is added
to existing entries when the next character is appended, without duplicating it.
Each character occupies a new line; existing content is preserved. Introductions
using the older text formats add `name=Character Name`. Character updates do not
append to this entry.

## Supported Name Formats

The extension recognizes character names in various formats:
- `Name: Character Name`
- `**Name:** Character Name`
- `**Name**: Character Name`
- `**Character Name**` (standalone bolded name)
- `<npc name="Character Name">...</npc>` (inside the configured delimiters)
- `<npc_update name="Character Name">...</npc_update>` (inside the configured delimiters)

Regression tests can be run with `node --test test/*.test.mjs`.

## How It Works

### Character Creation
1. When the AI generates a message with character introductions
2. The extension detects the `<!-- new character start` ... `new character end -->` delimiters
3. Extracts the character name and description
4. Creates a lorebook entry with the character name as the keyword
5. Removes the introduction block from the displayed message

### Character Updates
1. When the AI generates a message with character progression/updates
2. The extension detects the `<!-- update character start` ... `update character end -->` delimiters
3. Extracts the character name and update content
4. Appends to "Update for [Name]" or creates "Update [Name] #Number", depending on the selected mode
5. Removes the update block from the displayed message

## Settings

The extension settings can be found in **Extensions → Character Saver**:

- **Pause**: Stops processing new messages until unchecked. Skipped messages are not automatically replayed.
- **Lorebook scope**: **Chat** keeps a selection only for the current chat. **Character** shares a selection across chats with the same character, identified by its avatar filename. New chats inherit the character selection when one exists; explicitly choosing **Chat** keeps that chat independent, even with an empty selection. Switching scope preserves both selections. Group chats support **Chat** scope only.
- **Lorebook**: The explicit destination for character entries, **All NPC**, and both update modes. Selection and scope are restored when switching chats or characters. There is no global lorebook selection.
- **Create Lorebook**: Asks for a name and selects the new book for the active scope after creation succeeds. The suggested name is `{Character Name} Lorebook YYYY-MM-DD_HH-mm`, using local date and time. All colons in the suggested name, including those in the character name, are replaced with hyphens. Duplicate suggestions receive a numeric suffix; entering an existing name does not overwrite that book.
- **Refresh Lorebooks**: Reloads the available books after external creation, deletion, or renaming. An unavailable selection stays visible until explicitly replaced.
- **Character Creation Start Delimiter**: Marks the beginning of a character introduction (default: `<!-- new character start`)
- **Character Creation End Delimiter**: Marks the end of a character introduction (default: `new character end -->`)
- **Character Update Start Delimiter**: Marks the beginning of a character update (default: `<!-- update character start`)
- **Save each update as a separate entry**: Creates numbered entries instead of appending (default: off)
- **Character Update End Delimiter**: Marks the end of a character update (default: `update character end -->`)

## Troubleshooting

### Extension not working

- Make sure the extension is enabled in Extensions → Manage Extensions
- Check that your system prompt includes the delimiter instructions
- Open the browser console (F12) and check for errors prefixed with [CharacterSaver]

### No lorebook selected or selection unavailable

Open **Extensions → Character Saver** and select or create a lorebook below **Pause**. Existing installations must make an explicit selection once; the bound chat lorebook is not adopted automatically. If the selected book was renamed or deleted, refresh the list and choose an available book. Without a valid selection, nothing is written and delimiter blocks remain in the message for retry. A lorebook is created only through **Create Lorebook**.

Selecting a destination here does not activate it for prompt injection in SillyTavern. Configure World Info activation separately if the AI should use the saved entries.

Chat selections are saved in chat metadata. Character selections are stored in the extension settings under the character's avatar filename; preserve those settings when moving installations. Changing that filename requires choosing the character's lorebook again.

### Characters not being detected

- Verify the AI is using the correct delimiters: `<!-- new character start` and `new character end -->`
- Check the browser console for parsing errors
- Make sure the character name is in one of the supported formats

### Character updates not appearing

- Verify the AI is using the correct update delimiters: `<!-- update character start` and `update character end -->`
- The lorebook UI may need to be refreshed (toggle the lorebook panel) to see new update entries
- Check the browser console for [CharacterSaver] logs showing successful updates

## Files

- `manifest.json` - Extension metadata
- `index.js` - Main extension logic
- `README.md` - This file

## License

MIT License

## Author

hornysilicon

## Version

1.1.0
