# Character Saver - SillyTavern Extension

A SillyTavern extension that automatically creates chat lorebook entries when the AI introduces new characters or updates existing ones.

## Features

- **Character Creation**: Automatically detects character introductions in AI responses and creates chat-bound lorebook entries
- **Character Updates**: Detects character progression/updates and appends to existing "Update for [Name]" entries
- Removes character introduction and update blocks from the chat after processing
- Supports multiple character introductions/updates in a single message
- Supports flexible character name formats:
  - `**Name:** John Doe`
  - `**Name**: John Doe`
  - `Name: John Doe`
  - `**John Doe**`
  - `<npc name="John Doe">...</npc>` and `<npc_update name="John Doe">...</npc_update>`
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

### Format 4: NPC tag
```xml
<npc role="captain" name="María O'Connell">
Tall, observant, and habitually carries a brass compass.
</npc>
```

`<npc>` and `<npc_update>` names may use single or double quotes. Tag and attribute
capitalization, attribute order, extra attributes, and whitespace (including line
breaks around attributes and `=`) are accepted. XML/HTML entities in names are
decoded, so `name="John &amp; Jane"` is saved as `John & Jane`.

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

Updates may alternatively use a tag. The complete tag is retained in the stored
update, including attributes such as `timestamp`:

```xml
<npc_update timestamp="2024-07-07T08:39" name="John Doe">
Promoted to Captain.
</npc_update>
```

## Supported Name Formats

The extension recognizes character names in various formats:
- `Name: Character Name`
- `**Name:** Character Name`
- `**Name**: Character Name`
- `**Character Name**` (standalone bolded name)
- `<npc name="Character Name">...</npc>` for introductions
- `<npc_update name="Character Name">...</npc_update>` for updates

Tags may appear inside the configured legacy delimiters or as standalone blocks.
A standalone non-self-closing tag **must have its matching closing tag**; malformed
or unclosed tags are left untouched. Self-closing forms such as
`<npc name="John Doe" />` and `<npc_update name='John Doe' />` are supported as
metadata-only blocks. Missing or empty `name` attributes are not processed.
When a tag form is used, the `<npc>` or `<npc_update>` markup is preserved in the
lorebook content; only the surrounding configured delimiters are omitted.

## How It Works

### Character Creation
1. When the AI generates a message with character introductions
2. The extension detects configured delimiter blocks and standalone `<npc>` blocks
3. Extracts the character name and description
4. Creates a lorebook entry with the character name as the keyword
5. Removes the introduction block from the displayed message

### Character Updates
1. When the AI generates a message with character progression/updates
2. The extension detects configured delimiter blocks and standalone `<npc_update>` blocks
3. Extracts the character name and update content
4. Creates or appends to a lorebook entry with the comment "Update for [Name]"
5. Removes the update block from the displayed message

## Settings

The extension settings can be found in **Extensions → Character Saver**:

- **Character Creation Start Delimiter**: Marks the beginning of a character introduction (default: `<!-- new character start`)
- **Character Creation End Delimiter**: Marks the end of a character introduction (default: `new character end -->`)
- **Character Update Start Delimiter**: Marks the beginning of a character update (default: `<!-- update character start`)
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
