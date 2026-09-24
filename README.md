# Character Saver - SillyTavern Extension

A SillyTavern extension that automatically creates chat lorebook entries when the AI introduces new characters or updates existing ones.

## Features

- **Character Creation**: Automatically detects character introductions in AI responses and creates chat-bound lorebook entries
- **Character Updates**: Detects character progression/updates and appends to existing "Update for [Name]" entries
- Removes processed legacy delimiter blocks from chat; XML-style NPC elements remain visible
- Supports multiple character introductions/updates in a single message
- Supports flexible character name formats:
  - `**Name:** John Doe`
  - `Name: John Doe`
  - `**John Doe**`
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

You may instead use complete XML-style blocks:

```xml
<npc name="John Doe" role="captain">
Tall, lean, with short brown hair and blue eyes.
</npc>

<npc_update timestamp="2024-07-07T08:39" name='John Doe'>
John has been promoted to Captain.
</npc_update>
```

The `name` attribute is mandatory and must not be empty. It may be single- or
double-quoted, attributes may appear in any order or span multiple lines, and
arbitrary additional attributes are allowed. Tag and attribute names are matched
case-insensitively. A matching closing tag is required.

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

### XML-style tag
```xml
<npc faction="North" name = "Verena Cortez" data-note='met at dawn'>
Physical description: Early 30s, lean build, with close-cropped hair.
</npc>
```

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

If an "Update for [Name]" entry already exists, new content will be appended to it.

The complete original `<npc>` or `<npc_update>` element—including its opening
tag, all attributes, body, and closing tag—is stored byte-for-byte as lorebook
content. These elements also remain byte-for-byte in the chat after successful
processing. Only successfully processed legacy delimiter blocks are removed.

## Supported Name Formats

The extension recognizes character names in various formats:
- `Name: Character Name`
- `**Name:** Character Name`
- `**Name**: Character Name`
- `**Character Name**` (standalone bolded name)

## How It Works

### Character Creation
1. When the AI generates a message with character introductions
2. The extension detects the legacy delimiters or a complete `<npc name="...">...</npc>` element
3. Extracts the character name and description
4. Creates a lorebook entry with the character name as the keyword
5. Removes a legacy delimiter block; an `<npc>` element remains unchanged in chat

### Character Updates
1. When the AI generates a message with character progression/updates
2. The extension detects the legacy delimiters or a complete `<npc_update name="...">...</npc_update>` element
3. Extracts the character name and update content
4. Creates or appends to a lorebook entry with the comment "Update for [Name]"
5. Removes a legacy delimiter block; an `<npc_update>` element remains unchanged in chat

## Settings

The extension settings can be found in **Extensions → Character Saver**:

- **Character Creation Start Delimiter**: Marks the beginning of a character introduction (default: `<!-- new character start`)
- **Character Creation End Delimiter**: Marks the end of a character introduction (default: `new character end -->`)
- **Character Update Start Delimiter**: Marks the beginning of a character update (default: `<!-- update character start`)
- **Character Update End Delimiter**: Marks the end of a character update (default: `update character end -->`)

These settings affect only legacy syntax. XML-style NPC elements always use the
tag forms documented above and require a non-empty `name` attribute.

## Troubleshooting

### Extension not working

- Make sure the extension is enabled in Extensions → Manage Extensions
- Check that your system prompt includes the delimiter instructions
- Open the browser console (F12) and check for errors prefixed with [CharacterSaver]

### No lorebook active warning

The extension will automatically create a lorebook for your chat if one doesn't exist. The new lorebook will be named "{Character Name} Chat Lorebook YYYY-MM-DD HH:MM".

### Characters not being detected

- Verify the AI is using the correct legacy delimiters, or a complete `<npc name="...">...</npc>` element
- Check the browser console for parsing errors
- Make sure the character name is in one of the supported formats

### Character updates not appearing

- Verify the AI is using the correct update delimiters, or a complete `<npc_update name="...">...</npc_update>` element
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
