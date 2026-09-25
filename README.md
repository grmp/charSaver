# Character Saver - SillyTavern Extension

A SillyTavern extension that automatically creates chat lorebook entries when the AI introduces new characters or updates existing ones.

## Features

- **Character Creation**: Automatically detects character introductions in AI responses and creates chat-bound lorebook entries
- **All NPC**: Appends each new character's XML attributes to a shared "All NPC" lorebook entry, one character per line
- **Character Updates**: Detects character progression/updates and either appends to "Update for [Name]" or creates separate numbered entries
- Removes character introduction and update blocks from the chat after processing
- Supports multiple character introductions/updates in a single message
- Supports flexible character name formats:
  - `**Name:** John Doe`
  - `Name: John Doe`
  - `**John Doe**`
  - `<npc name="John Doe">...</npc>` and `<npc_update name="John Doe">...</npc_update>` inside the configured delimiters
- Auto-creates a lorebook if none exists
- Shows toast notifications when characters are added or updated

## Installation

1. In SillyTavern, go to **Extensions → Manage Extensions**
2. Click the **Install from URL** button
3. Paste this URL: `https://github.com/hornysilicon/charSaver`
4. Click **Install**
5. Enable the extension in the extensions list

## Setup

For the extension to work, you need to instruct the AI to use the special delimiters when introducing or updating characters.

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

Enable **Save each update as a separate entry** under **Extensions → Character Saver → Character Updates** to create "Update #1 for [Name]", "Update #2 for [Name]", etc. Each update block becomes its own entry. Numbers increase independently for each exact character name in each lorebook.

The last number is saved in the extension settings, so deleting entries does not reuse their numbers. Existing numbered entries are also checked when choosing the next number. Keep these settings when moving installations to preserve deleted entries' number history; lorebook renames are treated as a new counter scope.

Switching modes affects future updates only: existing entries are not renamed, split, or merged. Switching back to separate entries resumes numbering. This setting applies globally across chats.

## NPC XML Tags

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

Each new character is also appended to the chat lorebook entry **All NPC**, which
is created automatically if missing. All opening-tag attributes are included in
their original order as comma-separated `attribute=value` pairs, without quotes.
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
4. Appends to "Update for [Name]" or creates "Update #Number for [Name]", depending on the selected mode
5. Removes the update block from the displayed message

## Settings

The extension settings can be found in **Extensions → Character Saver**:

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

### No lorebook active warning

The extension will automatically create a lorebook for your chat if one doesn't exist. The new lorebook will be named "{Character Name} Chat Lorebook YYYY-MM-DD HH:MM".

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
