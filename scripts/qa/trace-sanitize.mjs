import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8 } from 'fflate';

export const redacted = '[REDACTED]';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
const sensitive = value => /token|csrf|secret|password|passphrase|authorization|cookie/.test(normalize(value))
  || /sessionid|sessionkey|apikey|cryptokey|encryptionkey|decryptionkey|privatekey|privatejwk|publickey|masterkey|wrappedkey|identitykey|keymaterial|secretkey|aeskey|hmackey|signingkey|recoverykey|backupkey|contentkey|sharedkey|conversationkey|devicekey|senderkey|keybundle/.test(normalize(value));
const decodeQuery = value => { try { return decodeURIComponent(value.replaceAll('+', ' ')); } catch { return value; } };
const decodeText = bytes => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; } };
const isJsonMime = mime => /(?:\/|\+)json(?:;|$)/i.test(mime);
const isTextMime = mime => /^(?:text\/|application\/(?:javascript|json|xml|x-www-form-urlencoded)|image\/svg\+xml)/i.test(mime) || /\+(?:json|xml)(?:;|$)/i.test(mime);

// Retain entry names and Playwright resource references. Their SHA1-like names are lookup
// identifiers for the viewer; the final sanitized ZIP gets its own SHA256 evidence hash.
export function sanitizeTraceArchive(input) {
  let entries;
  try { entries = unzipSync(input); } catch { throw new Error('Trace sanitizer: invalid ZIP'); }
  const names = Object.keys(entries);
  if (!names.some(name => name.endsWith('.trace')) || !names.some(name => name.endsWith('.network'))) throw new Error('Trace sanitizer: missing trace/network records');
  if (names.some(name => /(?:^|\/)\.\.(?:\/|$)|\\|^\//.test(name))) throw new Error('Trace sanitizer: unsafe entry name');
  const report = { schemaVersion: 1, status: 'PASS', entries: names.length, records: 0, structuredEntries: 0, textEntries: 0, binaryEntries: 0, redactions: 0, propagatedRedactions: 0, sourceSha256: digest(input) };
  const secrets = new Set(), documents = new Map(), mimeByResource = new Map();
  const parse = text => { try { return JSON.parse(text); } catch { throw new Error('Trace sanitizer: malformed structured content'); } };
  const remember = value => {
    if (typeof value === 'string') {
      // Short generic values are masked in their structured location, without destroying
      // unrelated UI words. Session tokens, passwords and keys propagate across resources.
      if (value.length >= 4 && value !== redacted && !value.includes(redacted)) secrets.add(value);
    } else if (Array.isArray(value)) value.forEach(remember);
    else if (value && typeof value === 'object') Object.values(value).forEach(remember);
  };
  const mask = (value, name = '') => {
    if (typeof value === 'string' && value === redacted) return value;
    remember(value);
    if (typeof value === 'string') {
      const normalized = normalize(name);
      if (/authorization/.test(normalized)) remember(value.replace(/^\S+\s+/, ''));
      if (/cookie/.test(normalized)) {
        const pairs = normalized === 'setcookie' ? value.split(';').slice(0, 1) : value.split(';');
        for (const part of pairs) { const index = part.indexOf('='); if (index >= 0) remember(decodeQuery(part.slice(index + 1).trim())); }
      }
    }
    report.redactions++;
    return redacted;
  };
  let variants = [];
  const propagate = text => {
    for (const secret of variants) if (text.includes(secret)) {
      report.propagatedRedactions += text.split(secret).length - 1;
      text = text.replaceAll(secret, redacted);
    }
    return text;
  };
  const cleanText = (original, depth) => {
    let text = original;
    if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
      let parsed;
      try { parsed = JSON.parse(text); } catch { /* It may be source text rather than JSON. */ }
      if (parsed && typeof parsed === 'object') return JSON.stringify(visit(parsed, '', depth + 1));
    }
    text = text.replace(/-----BEGIN [^-\r\n]*(?:PRIVATE|SECRET) KEY-----[\s\S]*?-----END [^-\r\n]*KEY-----/g, value => {
      remember(value.replace(/-----[^\r\n]+-----/g, '').trim());
      return mask(value, 'privateKey');
    });
    text = text.replace(/(https?:\/\/)([^/\s@]+)@/g, (_all, prefix, credentials) => {
      remember(decodeQuery(credentials.split(':').slice(1).join(':')));
      return `${prefix}${mask(credentials, 'password')}@`;
    });
    text = text.replace(/(^|[?&\s])([a-zA-Z0-9_%.-]+)=([^&\s"'<>#]+)/g, (all, prefix, name, value) => {
      if (!sensitive(decodeQuery(name))) return all;
      remember(decodeQuery(value));
      return `${prefix}${name}=${encodeURIComponent(mask(value, name))}`;
    });
    text = text.replace(/(["']?)([a-zA-Z_$][\w$-]*)\1(\s*[:=]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, (all, quote, name, separator, value) => {
      if (!sensitive(name)) return all;
      const inner = value.slice(1, -1);
      if (value[0] === '"') { try { remember(JSON.parse(value)); } catch { /* Preserve only the masking, never parser diagnostics. */ } }
      return `${quote}${name}${quote}${separator}${value[0]}${mask(inner, name)}${value[0]}`;
    });
    text = text.replace(/\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-[\w-]*(?:Token|Key|Secret)):[ \t]*([^\r\n]+)/gi, (_all, name, value) => `${name}: ${mask(value, name)}`);
    return propagate(text);
  };
  const visit = (value, hint = '', depth = 0) => {
    if (depth > 80) throw new Error('Trace sanitizer: excessive nesting');
    if (typeof value === 'string') return cleanText(value, depth);
    if (Array.isArray(value)) return value.map(child => visit(child, hint, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const output = {};
    const pair = typeof value.name === 'string' && Object.hasOwn(value, 'value') && (hint === 'cookies' || sensitive(value.name));
    const secretInput = value.type === 'password' || typeof value.selector === 'string' && /password|passphrase|парол/i.test(value.selector);
    const base64Body = value.encoding === 'base64' && typeof value.text === 'string';
    for (const [key, child] of Object.entries(value)) {
      if ((pair && key === 'value') || (secretInput && ['value', 'text'].includes(key)) || (value.kty && ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'].includes(key))
        || /crypto|encrypt|decrypt|keymaterial|keybundle|keybackup/i.test(hint) && ['key', 'raw', 'bytes', 'jwk', 'material'].includes(key)) {
        output[key] = mask(child, pair ? value.name : key);
      } else if (key === 'cookies' && Array.isArray(child)) {
        output[key] = visit(child, key, depth + 1);
      } else if (sensitive(key)) {
        output[key] = mask(child, key);
      } else if ((base64Body && key === 'text') || /^(?:postDataBuffer|bodyBase64)$/.test(key) && typeof child === 'string') {
        if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(child)) throw new Error('Trace sanitizer: invalid encoded body');
        const decoded = decodeText(Buffer.from(child, 'base64'));
        if (decoded === null) throw new Error('Trace sanitizer: unsupported encoded body');
        const cleaned = isJsonMime(value.mimeType ?? '') ? JSON.stringify(visit(parse(decoded), '', depth + 1)) : cleanText(decoded, depth + 1);
        output[key] = Buffer.from(cleaned).toString('base64');
      } else if (key === 'text' && typeof child === 'string' && child.trim() && isJsonMime(value.mimeType ?? '')) {
        output[key] = JSON.stringify(visit(parse(child), '', depth + 1));
      } else {
        output[key] = visit(child, key, depth + 1);
      }
    }
    return output;
  };
  const discoverResources = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value._sha1 === 'string') {
      const name = `resources/${value._sha1}`;
      if (!Object.hasOwn(entries, name)) throw new Error('Trace sanitizer: missing referenced resource');
      if (typeof value.mimeType === 'string') mimeByResource.set(name, value.mimeType);
    }
    Object.values(value).forEach(discoverResources);
  };
  for (const name of names.filter(name => /\.(?:trace|network|stacks)$/.test(name))) {
    const text = decodeText(entries[name]);
    if (text === null) throw new Error('Trace sanitizer: invalid record encoding');
    const jsonLines = !name.endsWith('.stacks');
    const data = jsonLines ? text.split(/\r?\n/).filter(Boolean).map(parse) : parse(text);
    discoverResources(data);
    report.records += jsonLines ? data.length : 0;
    documents.set(name, { kind: jsonLines ? 'jsonl' : 'json', data });
  }
  for (const name of names) {
    if (documents.has(name)) continue;
    const bytes = entries[name], mime = mimeByResource.get(name) ?? '';
    const text = decodeText(bytes);
    const structured = /\.json$/i.test(name) || isJsonMime(mime);
    if (structured && text === null) throw new Error('Trace sanitizer: invalid JSON encoding');
    if (structured) documents.set(name, { kind: 'json', data: parse(text) });
    else if (isTextMime(mime) || /\.(?:txt|html?|css|js|mjs|svg|xml)$/i.test(name) || text !== null && !text.includes('\0')) {
      if (text === null) throw new Error('Trace sanitizer: invalid text encoding');
      documents.set(name, { kind: 'text', data: text });
    } else { documents.set(name, { kind: 'binary', data: bytes }); report.binaryEntries++; }
  }
  // First collect secret values from every structured/text layer, then remove echoes
  // from earlier DOM snapshots, console messages and unrelated resource bodies.
  for (const document of documents.values()) {
    if (document.kind === 'binary') continue;
    document.data = visit(document.data);
    if (document.kind === 'text') report.textEntries++; else report.structuredEntries++;
  }
  const encoded = new Set();
  for (const secret of secrets) for (const value of [secret, encodeURIComponent(secret), encodeURI(secret), JSON.stringify(secret).slice(1, -1), Buffer.from(secret).toString('base64')]) encoded.add(value);
  variants = [...encoded].filter(value => value.length >= 4 && !value.includes(redacted)).sort((a, b) => b.length - a.length);
  const sanitized = {};
  for (const [name, document] of documents) {
    if (document.kind === 'binary') sanitized[name] = document.data;
    else {
      const data = visit(document.data);
      const text = document.kind === 'jsonl' ? data.map(row => JSON.stringify(row)).join('\n') + '\n' : document.kind === 'json' ? JSON.stringify(data) : data;
      sanitized[name] = strToU8(text);
    }
    // Fail closed for unexpected binary/key-name echoes; never print the offending value.
    for (const secret of variants) if (name.includes(secret) || Buffer.from(sanitized[name]).includes(Buffer.from(secret))) throw new Error('Trace sanitizer: residual sensitive value');
  }
  let bytes;
  try { bytes = zipSync(sanitized, { level: 6 }); } catch { throw new Error('Trace sanitizer: ZIP creation failed'); }
  report.sanitizedSha256 = digest(bytes);
  report.inputBytes = input.byteLength;
  report.outputBytes = bytes.byteLength;
  return { bytes, report };
}

export function sanitizeTraceFile(source, destination) {
  const { bytes, report } = sanitizeTraceArchive(readFileSync(source));
  // A fresh output prevents replacing old evidence or publishing a partially cleaned ZIP.
  writeFileSync(destination, bytes, { flag: 'wx' });
  return report;
}
