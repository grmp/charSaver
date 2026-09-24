const TAG_NAMES = {
    character: 'npc',
    update: 'npc_update',
};

export function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeEntities(value) {
    const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: '\u00a0' };
    return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, code) => {
        if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
        const radix = code[1].toLowerCase() === 'x' ? 16 : 10;
        const number = Number.parseInt(code.slice(radix === 16 ? 2 : 1), radix);
        try {
            return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
        } catch {
            return entity;
        }
    });
}

/** Parse and validate an opening NPC tag without confusing name-like attributes. */
function parseOpeningTag(source, expectedTag) {
    const match = source.match(/^<\s*([a-z_][\w:.-]*)([\s\S]*?)>$/i);
    if (!match || match[1].toLowerCase() !== expectedTag || /\/\s*>$/.test(source)) return null;

    const attributes = new Map();
    const input = match[2];
    const attribute = /\s+([a-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/iy;
    let position = 0;
    while (position < input.length) {
        attribute.lastIndex = position;
        const item = attribute.exec(input);
        if (!item) {
            if (/^\s*$/.test(input.slice(position))) break;
            return null;
        }
        attributes.set(item[1].toLowerCase(), item[2] ?? item[3] ?? null);
        position = attribute.lastIndex;
    }

    const rawName = attributes.get('name');
    const name = rawName == null ? '' : decodeEntities(rawName).trim();
    return name ? { name } : null;
}

function legacyRanges(message, startDelimiter, endDelimiter) {
    if (!startDelimiter || !endDelimiter) return [];
    const regex = new RegExp(`${escapeRegExp(startDelimiter)}[\\s\\S]*?${escapeRegExp(endDelimiter)}`, 'gi');
    return [...message.matchAll(regex)].map(match => ({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        syntax: 'legacy',
    }));
}

/** Find complete, valid elements. The returned text is always the exact source slice. */
function tagRanges(message, tagName) {
    const opening = new RegExp(`<\\s*${tagName}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'gi');
    const ranges = [];
    let match;
    while ((match = opening.exec(message)) !== null) {
        const parsed = parseOpeningTag(match[0], tagName);
        if (!parsed) continue;

        const closing = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'gi');
        closing.lastIndex = opening.lastIndex;
        const close = closing.exec(message);
        if (!close) continue;

        // An earlier unmatched opening tag must not swallow a later valid element.
        const between = message.slice(opening.lastIndex, close.index);
        if (new RegExp(`<\\s*${tagName}\\b`, 'i').test(between)) continue;

        ranges.push({
            start: match.index,
            end: closing.lastIndex,
            text: message.slice(match.index, closing.lastIndex),
            syntax: 'tag',
            name: parsed.name,
        });
        opening.lastIndex = closing.lastIndex;
    }
    return ranges;
}

export function detectBlockRanges(message, kind, delimiters) {
    const legacy = legacyRanges(message, delimiters.start, delimiters.end);
    const tags = tagRanges(message, TAG_NAMES[kind])
        .filter(tag => !legacy.some(block => tag.start >= block.start && tag.end <= block.end));
    return [...legacy, ...tags].sort((left, right) => left.start - right.start);
}

function legacyContent(block, delimiters) {
    if (!block.toLowerCase().startsWith(delimiters.start.toLowerCase())
        || !block.toLowerCase().endsWith(delimiters.end.toLowerCase())) return null;
    return block.slice(delimiters.start.length, -delimiters.end.length).trim();
}

function extractLegacyName(content) {
    const patterns = [
        /^\s*\*\*Name:\*\*\s*(.+?)\s*$/im,
        /^\s*\*\*Name\*\*\s*:\s*(.+?)\s*$/im,
        /^\s*Name\s*:\s*(.+?)\s*$/im,
        /^\s*\*\*([^*\r\n]+)\*\*\s*$/m,
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(content);
        const name = match?.[1]?.trim();
        if (name) return { name, content: `${content.slice(0, match.index)}${content.slice(match.index + match[0].length)}`.trim() };
    }
    return null;
}

export function parseBlock(block, kind, delimiters) {
    const tagName = TAG_NAMES[kind];
    const opening = new RegExp(`^<\\s*${tagName}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'i').exec(block);
    if (opening) {
        const tag = parseOpeningTag(opening[0], tagName);
        const closing = new RegExp(`<\\/\\s*${tagName}\\s*>$`, 'i');
        if (!tag || !closing.test(block)) return null;
        return kind === 'character'
            ? { name: tag.name, description: block }
            : { name: tag.name, content: block };
    }

    const content = legacyContent(block, delimiters);
    if (content === null) return null;
    const extracted = extractLegacyName(content);
    if (!extracted) return null;
    return kind === 'character'
        ? { name: extracted.name, description: extracted.content || `Character named ${extracted.name}` }
        : { name: extracted.name, content };
}

/** Remove only successful legacy ranges; tag elements deliberately remain in chat. */
export function removeLegacyRanges(message, ranges) {
    return ranges.filter(range => range.syntax === 'legacy')
        .sort((left, right) => right.start - left.start)
        .reduce((result, range) => `${result.slice(0, range.start)}${result.slice(range.end)}`, message)
        .trim();
}
