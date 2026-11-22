/**
 * Pure Node.js zero-dependency YAML 1.2 subset parser for GitHub Actions workflow validation.
 *
 * Supports:
 * - Block mappings (plain & quoted keys, nested mappings/sequences)
 * - Block sequences (`- scalar`, `- key: value` compact mappings, nested sequences)
 * - Literal (`|`, `|-`, `|+`) and folded (`>`, `>-`, `>+`) block scalars with optional indent indicators
 * - Multiline plain & quoted scalars (e.g., multiline `if:` expressions)
 * - Flow sequences (`[...]`) and flow mappings (`{...}`), including multiline flow collections
 * - Single-quoted (`''` escape) and double-quoted (`\n`, `\t`, `\"`, `\\`, `\uXXXX`) scalars
 * - YAML 1.2 scalar types (`null`/`~`, booleans, numbers, strings; `on` stays `'on'`)
 * - Comments (`# ...`) and strict syntax error reporting on malformed YAML
 */

/**
 * Strip inline comments outside of single/double quotes and flow brackets.
 * Per YAML spec, `#` starts a comment only when preceded by whitespace (or at index 0).
 */
function stripInlineComment(line) {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (line[i + 1] === "'") {
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

/**
 * Find the mapping separator `:` outside quotes and flow brackets/braces.
 * In YAML, a block mapping colon must be followed by whitespace or end-of-line.
 */
function findMappingColon(text) {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inDouble) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
    } else if (ch === "'") {
      inSingle = true;
    } else if (ch === '[') {
      bracketDepth += 1;
    } else if (ch === ']') {
      bracketDepth -= 1;
    } else if (ch === '{') {
      braceDepth += 1;
    } else if (ch === '}') {
      braceDepth -= 1;
    } else if (ch === ':' && bracketDepth === 0 && braceDepth === 0) {
      const next = text[i + 1];
      if (next === undefined || next === ' ' || next === '\t') {
        return i;
      }
    }
  }
  return -1;
}

function unescapeDoubleQuoted(raw, ctxLabel) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= raw.length) {
      throw new SyntaxError(`${ctxLabel}: trailing backslash in double-quoted scalar`);
    }
    const esc = raw[i];
    switch (esc) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case '0':
        out += '\0';
        break;
      case '\\':
        out += '\\';
        break;
      case '"':
        out += '"';
        break;
      case '/':
        out += '/';
        break;
      case 'b':
        out += '\b';
        break;
      case 'f':
        out += '\f';
        break;
      case 'u': {
        const hex = raw.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          throw new SyntaxError(`${ctxLabel}: invalid \\u escape "\\u${hex}"`);
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
        break;
      }
      case 'x': {
        const hex = raw.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
          throw new SyntaxError(`${ctxLabel}: invalid \\x escape "\\x${hex}"`);
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        break;
      }
      default:
        out += esc;
        break;
    }
  }
  return out;
}

function parseScalar(raw, ctxLabel) {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === 'Null' || s === 'NULL' || s === '~') {
    return null;
  }
  if (s === 'true' || s === 'True' || s === 'TRUE') {
    return true;
  }
  if (s === 'false' || s === 'False' || s === 'FALSE') {
    return false;
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) {
      throw new SyntaxError(`${ctxLabel}: unterminated single-quoted scalar`);
    }
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) {
      throw new SyntaxError(`${ctxLabel}: unterminated double-quoted scalar`);
    }
    return unescapeDoubleQuoted(s.slice(1, -1), ctxLabel);
  }
  if (/^[+-]?(?:0|[1-9][0-9]*)$/.test(s)) {
    const num = Number(s);
    if (Number.isSafeInteger(num)) return num;
  }
  if (/^0x[0-9a-fA-F]+$/.test(s)) {
    return parseInt(s, 16);
  }
  if (/^[+-]?(?:[0-9]+\.[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(s)) {
    return Number(s);
  }
  if (/^[+-]?[0-9]+[eE][+-]?[0-9]+$/.test(s)) {
    return Number(s);
  }
  return s;
}

function parseKey(raw, ctxLabel) {
  const s = raw.trim();
  if (s.startsWith("'") || s.startsWith('"')) {
    return String(parseScalar(s, ctxLabel));
  }
  return s;
}

function splitFlowItems(inner, ctxLabel) {
  const items = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inDouble) {
      current += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (inSingle) {
      current += ch;
      if (ch === "'") {
        if (inner[i + 1] === "'") {
          current += "'";
          i += 1;
        } else {
          inSingle = false;
        }
      }
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
    } else if (ch === "'") {
      inSingle = true;
      current += ch;
    } else if (ch === '[') {
      bracketDepth += 1;
      current += ch;
    } else if (ch === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) throw new SyntaxError(`${ctxLabel}: unexpected ']'`);
      current += ch;
    } else if (ch === '{') {
      braceDepth += 1;
      current += ch;
    } else if (ch === '}') {
      braceDepth -= 1;
      if (braceDepth < 0) throw new SyntaxError(`${ctxLabel}: unexpected '}'`);
      current += ch;
    } else if (ch === ',' && bracketDepth === 0 && braceDepth === 0) {
      items.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (inSingle || inDouble || bracketDepth !== 0 || braceDepth !== 0) {
    throw new SyntaxError(`${ctxLabel}: unclosed flow collection or quote`);
  }
  if (current.trim().length > 0) {
    items.push(current.trim());
  }
  return items;
}

function parseFlowValue(raw, ctxLabel) {
  const s = raw.trim();
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) {
      throw new SyntaxError(`${ctxLabel}: unclosed flow sequence`);
    }
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return splitFlowItems(inner, ctxLabel).map((item) => parseFlowValue(item, ctxLabel));
  }
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) {
      throw new SyntaxError(`${ctxLabel}: unclosed flow mapping`);
    }
    const inner = s.slice(1, -1).trim();
    if (!inner) return {};
    const obj = {};
    for (const entry of splitFlowItems(inner, ctxLabel)) {
      const colonIdx = findMappingColon(entry);
      if (colonIdx === -1) {
        // Also support JSON-style `"key":value` without space after colon in flow mappings
        const jsonColon = entry.indexOf(':');
        if (jsonColon === -1) {
          throw new SyntaxError(`${ctxLabel}: invalid flow mapping entry "${entry}"`);
        }
        const k = parseKey(entry.slice(0, jsonColon), ctxLabel);
        obj[k] = parseFlowValue(entry.slice(jsonColon + 1), ctxLabel);
      } else {
        const k = parseKey(entry.slice(0, colonIdx), ctxLabel);
        const vRaw = entry.slice(colonIdx + 1).trim();
        obj[k] = vRaw === '' ? null : parseFlowValue(vRaw, ctxLabel);
      }
    }
    return obj;
  }
  return parseScalar(s, ctxLabel);
}

function isFlowBalanced(text) {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let bracketDepth = 0;
  let braceDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inDouble) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") {
        if (text[i + 1] === "'") i += 1;
        else inSingle = false;
      }
      continue;
    }
    if (ch === '"') inDouble = true;
    else if (ch === "'") inSingle = true;
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']') bracketDepth -= 1;
    else if (ch === '{') braceDepth += 1;
    else if (ch === '}') braceDepth -= 1;
  }
  return !inSingle && !inDouble && bracketDepth === 0 && braceDepth === 0;
}

/**
 * Parse a YAML document string into a plain JS value.
 * Throws SyntaxError with filename and line number on malformed YAML.
 */
export function parseYaml(source, filename = '<yaml>') {
  if (typeof source !== 'string') {
    throw new TypeError(`${filename}: YAML source must be a string`);
  }
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = normalized.split('\n');
  const totalLines = rawLines.length;
  let lineIdx = 0;

  function ctx(idx = lineIdx) {
    return `${filename}:${idx + 1}`;
  }

  function getIndent(line, idx) {
    let i = 0;
    while (i < line.length && line[i] === ' ') i += 1;
    if (line[i] === '\t') {
      throw new SyntaxError(`${ctx(idx)}: tabs are not allowed for YAML indentation`);
    }
    return i;
  }

  function skipIgnorable() {
    while (lineIdx < totalLines) {
      const raw = rawLines[lineIdx];
      const trimmed = raw.trim();
      if (trimmed === '' || trimmed.startsWith('#') || trimmed === '---' || trimmed === '...') {
        lineIdx += 1;
        continue;
      }
      break;
    }
  }

  function parseBlockScalar(header, parentIndent) {
    const match = header.match(/^([|>])([+-]?)([1-9]?)([+-]?)$/);
    if (!match) {
      throw new SyntaxError(`${ctx(lineIdx - 1)}: invalid block scalar header "${header}"`);
    }
    const style = match[1];
    const chomp = match[2] || match[4] || 'clip';
    const explicitIndent = match[3] ? parseInt(match[3], 10) : null;

    const collected = [];
    let blockIndent = explicitIndent !== null ? parentIndent + explicitIndent : null;

    while (lineIdx < totalLines) {
      const raw = rawLines[lineIdx];
      if (raw.trim() === '') {
        collected.push('');
        lineIdx += 1;
        continue;
      }
      let spaces = 0;
      while (spaces < raw.length && raw[spaces] === ' ') spaces += 1;
      if (blockIndent === null) {
        if (spaces <= parentIndent) {
          break;
        }
        blockIndent = spaces;
      }
      if (spaces < blockIndent) {
        break;
      }
      collected.push(raw.slice(blockIndent));
      lineIdx += 1;
    }

    // Separate trailing empty lines for chomping
    let trailingNewlines = 0;
    while (collected.length > 0 && collected[collected.length - 1] === '') {
      collected.pop();
      trailingNewlines += 1;
    }

    let text;
    if (style === '|') {
      text = collected.join('\n');
    } else {
      // Folded scalar (`>`): join non-empty unindented lines with spaces; preserve blank lines & indented lines
      const parts = [];
      for (let i = 0; i < collected.length; i++) {
        const cur = collected[i];
        const prev = i > 0 ? collected[i - 1] : null;
        if (i === 0) {
          parts.push(cur);
        } else if (cur === '') {
          parts.push('\n');
        } else if (prev === '') {
          parts.push(cur);
        } else if (cur.startsWith(' ') || (prev !== null && prev.startsWith(' '))) {
          parts.push('\n' + cur);
        } else {
          parts.push(' ' + cur);
        }
      }
      text = parts.join('');
    }

    if (collected.length === 0) {
      return chomp === '+' ? '\n'.repeat(trailingNewlines) : '';
    }
    if (chomp === '-') {
      return text;
    }
    if (chomp === '+') {
      return text + '\n'.repeat(1 + trailingNewlines);
    }
    return text + '\n';
  }

  function parseInlineOrMultilineValue(valRaw, parentIndent, startIdx) {
    // Block scalar header (`|`, `|-`, `|+`, `>`, `>-`, `>+`)
    if (/^[|>][+-]?[1-9]?[+-]?$/.test(valRaw)) {
      return parseBlockScalar(valRaw, parentIndent);
    }

    // Flow sequence or mapping (possibly spanning multiple lines)
    if (valRaw.startsWith('[') || valRaw.startsWith('{')) {
      let combined = valRaw;
      while (!isFlowBalanced(combined) && lineIdx < totalLines) {
        const nextLine = stripInlineComment(rawLines[lineIdx]).trim();
        lineIdx += 1;
        if (nextLine) combined += ' ' + nextLine;
      }
      return parseFlowValue(combined, ctx(startIdx));
    }

    // Quoted scalar (possibly spanning multiple lines)
    if (valRaw.startsWith("'") || valRaw.startsWith('"')) {
      const quote = valRaw[0];
      let combined = valRaw;
      while (lineIdx < totalLines) {
        try {
          return parseScalar(combined, ctx(startIdx));
        } catch {
          const nextRaw = rawLines[lineIdx];
          if (nextRaw.trim() === '') {
            combined += '\n';
            lineIdx += 1;
            continue;
          }
          const nextIndent = getIndent(nextRaw, lineIdx);
          if (nextIndent <= parentIndent) {
            throw new SyntaxError(`${ctx(startIdx)}: unterminated ${quote === "'" ? 'single' : 'double'}-quoted scalar`);
          }
          combined += ' ' + nextRaw.trim();
          lineIdx += 1;
        }
      }
      return parseScalar(combined, ctx(startIdx));
    }

    // Plain scalar (may continue on subsequent more-indented lines)
    let combined = valRaw;
    while (lineIdx < totalLines) {
      const nextRaw = rawLines[lineIdx];
      const nextStripped = stripInlineComment(nextRaw);
      const nextTrimmed = nextStripped.trim();
      if (nextTrimmed === '') {
        // Peek ahead to see if continuation follows blank line
        let peek = lineIdx + 1;
        while (peek < totalLines && rawLines[peek].trim() === '') peek += 1;
        if (peek < totalLines) {
          const peekStripped = stripInlineComment(rawLines[peek]).trim();
          const peekIndent = getIndent(rawLines[peek], peek);
          if (
            peekStripped !== '' &&
            peekIndent > parentIndent &&
            !peekStripped.startsWith('- ') &&
            peekStripped !== '-' &&
            findMappingColon(peekStripped) === -1
          ) {
            combined += '\n';
            lineIdx += 1;
            continue;
          }
        }
        break;
      }
      const nextIndent = getIndent(nextRaw, lineIdx);
      if (nextIndent <= parentIndent) break;
      if (nextTrimmed.startsWith('- ') || nextTrimmed === '-' || findMappingColon(nextTrimmed) !== -1) {
        break;
      }
      combined += ' ' + nextTrimmed;
      lineIdx += 1;
    }
    return parseScalar(combined, ctx(startIdx));
  }

  function parseBlockNode(minIndent) {
    skipIgnorable();
    if (lineIdx >= totalLines) return null;
    const raw = rawLines[lineIdx];
    const indent = getIndent(raw, lineIdx);
    if (indent < minIndent) return null;

    const stripped = stripInlineComment(raw).slice(indent);
    if (stripped === '-' || stripped.startsWith('- ')) {
      return parseSequence(indent);
    }
    if (findMappingColon(stripped) !== -1) {
      return parseMapping(indent);
    }
    const startIdx = lineIdx;
    lineIdx += 1;
    return parseInlineOrMultilineValue(stripped, indent, startIdx);
  }

  function parseSequence(seqIndent) {
    const arr = [];
    while (lineIdx < totalLines) {
      skipIgnorable();
      if (lineIdx >= totalLines) break;
      const raw = rawLines[lineIdx];
      const indent = getIndent(raw, lineIdx);
      if (indent < seqIndent) break;
      if (indent > seqIndent) {
        throw new SyntaxError(`${ctx(lineIdx)}: unexpected indentation ${indent} inside sequence at indent ${seqIndent}`);
      }
      const stripped = stripInlineComment(raw).slice(indent);
      if (stripped !== '-' && !stripped.startsWith('- ')) {
        break;
      }

      const startIdx = lineIdx;
      const afterDash = stripped === '-' ? '' : stripped.slice(2);
      lineIdx += 1;

      if (afterDash.trim() === '') {
        // Nested block value on subsequent lines
        skipIgnorable();
        if (lineIdx >= totalLines) {
          arr.push(null);
          break;
        }
        const nextIndent = getIndent(rawLines[lineIdx], lineIdx);
        if (nextIndent <= seqIndent) {
          arr.push(null);
        } else {
          arr.push(parseBlockNode(nextIndent));
        }
        continue;
      }

      const itemIndent = seqIndent + 2;
      const itemContent = afterDash.trimStart();
      const extraOffset = afterDash.length - itemContent.length;
      const effectiveItemIndent = itemIndent + extraOffset;

      // Compact nested sequence: `- - item`
      if (itemContent === '-' || itemContent.startsWith('- ')) {
        // Synthesize inline line so parseSequence can consume it
        rawLines[startIdx] = ' '.repeat(effectiveItemIndent) + itemContent;
        lineIdx = startIdx;
        arr.push(parseSequence(effectiveItemIndent));
        continue;
      }

      // Compact mapping inside sequence item: `- key: value`
      const colonIdx = findMappingColon(itemContent);
      if (colonIdx !== -1) {
        const obj = {};
        const key = parseKey(itemContent.slice(0, colonIdx), ctx(startIdx));
        const valRaw = itemContent.slice(colonIdx + 1).trim();
        if (valRaw === '') {
          skipIgnorable();
          if (lineIdx < totalLines) {
            const nextIndent = getIndent(rawLines[lineIdx], lineIdx);
            if (nextIndent > effectiveItemIndent) {
              obj[key] = parseBlockNode(nextIndent);
            } else if (nextIndent === effectiveItemIndent) {
              const nextStripped = stripInlineComment(rawLines[lineIdx]).slice(nextIndent);
              if (nextStripped === '-' || nextStripped.startsWith('- ')) {
                obj[key] = parseSequence(nextIndent);
              } else {
                obj[key] = null;
              }
            } else {
              obj[key] = null;
            }
          } else {
            obj[key] = null;
          }
        } else {
          obj[key] = parseInlineOrMultilineValue(valRaw, effectiveItemIndent, startIdx);
        }
        // Parse any sibling mapping keys indented at `effectiveItemIndent`
        parseMappingEntries(obj, effectiveItemIndent);
        arr.push(obj);
        continue;
      }

      // Scalar or flow collection sequence item
      arr.push(parseInlineOrMultilineValue(itemContent, seqIndent, startIdx));
    }
    return arr;
  }

  function parseMappingEntries(obj, mapIndent) {
    while (lineIdx < totalLines) {
      skipIgnorable();
      if (lineIdx >= totalLines) break;
      const raw = rawLines[lineIdx];
      const indent = getIndent(raw, lineIdx);
      if (indent < mapIndent) break;
      if (indent > mapIndent) {
        throw new SyntaxError(`${ctx(lineIdx)}: unexpected indentation ${indent} inside mapping at indent ${mapIndent}`);
      }
      const stripped = stripInlineComment(raw).slice(indent);
      if (stripped === '-' || stripped.startsWith('- ')) {
        break;
      }
      const colonIdx = findMappingColon(stripped);
      if (colonIdx === -1) {
        throw new SyntaxError(`${ctx(lineIdx)}: expected mapping key: value, found "${stripped}"`);
      }

      const startIdx = lineIdx;
      const key = parseKey(stripped.slice(0, colonIdx), ctx(startIdx));
      const valRaw = stripped.slice(colonIdx + 1).trim();
      lineIdx += 1;

      if (valRaw === '') {
        skipIgnorable();
        if (lineIdx >= totalLines) {
          obj[key] = null;
          break;
        }
        const nextIndent = getIndent(rawLines[lineIdx], lineIdx);
        if (nextIndent > mapIndent) {
          obj[key] = parseBlockNode(nextIndent);
        } else if (nextIndent === mapIndent) {
          const nextStripped = stripInlineComment(rawLines[lineIdx]).slice(nextIndent);
          if (nextStripped === '-' || nextStripped.startsWith('- ')) {
            obj[key] = parseSequence(nextIndent);
          } else {
            obj[key] = null;
          }
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseInlineOrMultilineValue(valRaw, mapIndent, startIdx);
      }
    }
    return obj;
  }

  function parseMapping(mapIndent) {
    return parseMappingEntries({}, mapIndent);
  }

  skipIgnorable();
  if (lineIdx >= totalLines) return null;
  const result = parseBlockNode(0);
  skipIgnorable();
  if (lineIdx < totalLines) {
    throw new SyntaxError(`${ctx(lineIdx)}: unexpected trailing content "${rawLines[lineIdx].trim()}"`);
  }
  return result;
}
