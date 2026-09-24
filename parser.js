const TAG_NAMES = {
    character: 'npc',
    update: 'npc_update',
};

export function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function decodeEntities(value) {
    const named = { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"', nbsp: '\u00a0' };
    return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, code) => {
        if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
        const radix = code[1].toLowerCase() === 'x' ? 16 : 10;
        const number = parseInt(code.slice(radix === 16 ? 2 : 1), radix);
        try { return Number.isFinite(number) ? String.fromCodePoint(number) : entity; } catch { return entity; }
    });
}

function parseOpeningTag(source, expectedTag) {
    const match = source.match(/^<\s*([a-z_][\w:.-]*)([\s\S]*?)>$/i);
    if (!match || match[1].toLowerCase() !== expectedTag) return null;
    let attributes = match[2].replace(/\/\s*$/, '');
    const parsed = new Map();
    const attribute = /\s+([a-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/iy;
    let position = 0;
    while (position < attributes.length) {
        attribute.lastIndex = position;
        const item = attribute.exec(attributes);
        if (!item) {
            if (/^\s*$/.test(attributes.slice(position))) break;
            return null;
        }
        parsed.set(item[1].toLowerCase(), item[2] ?? item[3] ?? null);
        position = attribute.lastIndex;
    }
    return { attributes: parsed, selfClosing: /\/\s*>$/.test(source) };
}

function openingTagAt(content, tagName) {
    const tag = new RegExp(`<\\s*${tagName}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'i').exec(content);
    if (!tag) return null;
    const parsed = parseOpeningTag(tag[0], tagName);
    return parsed ? { ...parsed, text: tag[0], index: tag.index } : null;
}

/** Extract a name while preserving tag-based content and removing legacy name metadata. */
export function extractName(content, kind = 'character') {
    const tagName = TAG_NAMES[kind];
    const tag = openingTagAt(content, tagName);
    if (tag) {
        const rawName = tag.attributes.get('name');
        const name = rawName === null || rawName === undefined ? '' : decodeEntities(rawName).trim();
        if (!name) return null;
        return { name, content: content.trim() };
    }

    const linePatterns = [
        /^\s*\*\*Name:\*\*\s*(.+?)\s*$/im,
        /^\s*\*\*Name\*\*\s*:\s*(.+?)\s*$/im,
        /^\s*Name\s*:\s*(.+?)\s*$/im,
        /^\s*\*\*([^*\r\n]+)\*\*\s*$/m,
    ];
    for (const pattern of linePatterns) {
        const match = pattern.exec(content);
        const name = match?.[1]?.trim();
        if (name) return { name, content: `${content.slice(0, match.index)}${content.slice(match.index + match[0].length)}`.trim() };
    }
    return null;
}

function legacyRanges(message, startDelimiter, endDelimiter) {
    if (!startDelimiter || !endDelimiter) return [];
    const regex = new RegExp(`${escapeRegExp(startDelimiter)}[\\s\\S]*?${escapeRegExp(endDelimiter)}`, 'gi');
    return [...message.matchAll(regex)].map(match => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
}

function tagRanges(message, tagName) {
    const opening = new RegExp(`<\\s*${tagName}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'gi');
    const ranges = [];
    let match;
    while ((match = opening.exec(message))) {
        const parsed = parseOpeningTag(match[0], tagName);
        if (!parsed) continue;
        if (parsed.selfClosing) {
            ranges.push({ start: match.index, end: opening.lastIndex, text: match[0] });
            continue;
        }
        const closing = new RegExp(`<\\/\\s*${tagName}\\s*>`, 'gi');
        closing.lastIndex = opening.lastIndex;
        const close = closing.exec(message);
        if (!close) continue;
        // Do not let an unclosed tag consume a later, otherwise valid element.
        const nestedOpening = new RegExp(`<\\s*${tagName}\\b`, 'i').exec(message.slice(opening.lastIndex, close.index));
        if (nestedOpening) continue;
        ranges.push({ start: match.index, end: closing.lastIndex, text: message.slice(match.index, closing.lastIndex) });
        opening.lastIndex = closing.lastIndex;
    }
    return ranges;
}

export function detectBlockRanges(message, kind, delimiters) {
    const legacy = legacyRanges(message, delimiters.start, delimiters.end);
    const tags = tagRanges(message, TAG_NAMES[kind]).filter(tag => !legacy.some(old => tag.start >= old.start && tag.end <= old.end));
    return [...legacy, ...tags].sort((a, b) => a.start - b.start);
}

export function parseBlock(block, kind, delimiters) {
    let content = block;
    if (content.toLowerCase().startsWith(delimiters.start.toLowerCase()) && content.toLowerCase().endsWith(delimiters.end.toLowerCase())) {
        content = content.slice(delimiters.start.length, -delimiters.end.length).trim();
    }
    const extracted = extractName(content.trim(), kind);
    if (!extracted) return null;
    if (kind === 'character') return { name: extracted.name, description: extracted.content || `Character named ${extracted.name}` };
    return { name: extracted.name, content: extracted.content };
}

export function removeRanges(message, ranges) {
    return [...ranges].sort((a, b) => b.start - a.start).reduce(
        (result, range) => `${result.slice(0, range.start)}${result.slice(range.end)}`,
        message,
    ).trim();
}
