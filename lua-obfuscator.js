// ════════════════════════════════════════════════════════════
//  LuaShield — Lua Obfuscation Engine (Prometheus-Enhanced)
//  Supports: Luau / Roblox (Lua 5.3+ with ~ bitwise XOR)
// ════════════════════════════════════════════════════════════

// ─── Token Types ─────────────────────────────────────────────
const T = {
  COMMENT : 'COMMENT',
  STRING  : 'STRING',
  NUMBER  : 'NUMBER',
  KEYWORD : 'KEYWORD',
  IDENT   : 'IDENT',
  OP      : 'OP',
  WS      : 'WS',
  NL      : 'NL',
  OTHER   : 'OTHER'
};

const LUA_KEYWORDS = new Set([
  'and','break','do','else','elseif','end','false','for',
  'function','goto','if','in','local','nil','not','or',
  'repeat','return','then','true','until','while'
]);

// ─── Token ───────────────────────────────────────────────────
class Token {
  constructor(type, value) {
    this.type  = type;
    this.value = value;
  }
}

// ════════════════════════════════════════════════════════════
//  LEXER
// ════════════════════════════════════════════════════════════
function tokenize(src) {
  const tokens = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    // ── Newlines
    if (ch === '\n') {
      tokens.push(new Token(T.NL, '\n')); i++; continue;
    }
    if (ch === '\r') {
      const nl = src[i+1] === '\n' ? '\r\n' : '\r';
      tokens.push(new Token(T.NL, nl));
      i += nl.length; continue;
    }

    // ── Whitespace
    if (ch === ' ' || ch === '\t') {
      let ws = '';
      while (i < len && (src[i] === ' ' || src[i] === '\t')) ws += src[i++];
      tokens.push(new Token(T.WS, ws)); continue;
    }

    // ── Comments  --  or  --[[ ]]
    if (ch === '-' && src[i+1] === '-') {
      i += 2;
      if (src[i] === '[') {
        const lvl = getLongBracketLevel(src, i);
        if (lvl >= 0) {
          i += lvl + 2; // skip [=*[
          const [content, end] = readLongBody(src, i, lvl);
          tokens.push(new Token(T.COMMENT, '--' + '[' + '='.repeat(lvl) + '[' + content));
          i = end; continue;
        }
      }
      let cmt = '--';
      while (i < len && src[i] !== '\n' && src[i] !== '\r') cmt += src[i++];
      tokens.push(new Token(T.COMMENT, cmt)); continue;
    }

    // ── Long strings  [[ ]] or [=[ ]=]
    if (ch === '[' && (src[i+1] === '[' || src[i+1] === '=')) {
      const savedI = i;
      const lvl = getLongBracketLevel(src, i);
      if (lvl >= 0) {
        i += lvl + 2;
        const [content, end] = readLongBody(src, i, lvl);
        tokens.push(new Token(T.STRING, '[' + '='.repeat(lvl) + '[' + content));
        i = end; continue;
      }
      i = savedI;
    }

    // ── Short strings  "..."  '...'
    if (ch === '"' || ch === "'") {
      const [str, end] = readShortString(src, i);
      tokens.push(new Token(T.STRING, str));
      i = end; continue;
    }

    // ── Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i+1] || ''))) {
      const [num, end] = readNumber(src, i);
      tokens.push(new Token(T.NUMBER, num));
      i = end; continue;
    }

    // ── Identifiers / Keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < len && /[a-zA-Z0-9_]/.test(src[i])) id += src[i++];
      tokens.push(new Token(LUA_KEYWORDS.has(id) ? T.KEYWORD : T.IDENT, id));
      continue;
    }

    // ── Multi-char operators
    const three = src.slice(i, i+3);
    if (three === '...') { tokens.push(new Token(T.OP, '...')); i += 3; continue; }
    const two = src.slice(i, i+2);
    if (['==','~=','<=','>=','..','::','//','<<','>>'].includes(two)) {
      tokens.push(new Token(T.OP, two)); i += 2; continue;
    }

    tokens.push(new Token(T.OTHER, src[i++]));
  }

  return tokens;
}

function getLongBracketLevel(src, i) {
  if (src[i] !== '[') return -1;
  let lvl = 0, j = i + 1;
  while (j < src.length && src[j] === '=') { lvl++; j++; }
  return src[j] === '[' ? lvl : -1;
}

function readLongBody(src, start, level) {
  const closing = ']' + '='.repeat(level) + ']';
  let i = start;
  // Lua skips first newline in long strings
  if (src[i] === '\n') i++;
  else if (src[i] === '\r') { i++; if (src[i] === '\n') i++; }
  let content = '';
  while (i < src.length) {
    if (src.startsWith(closing, i)) return [content, i + closing.length];
    content += src[i++];
  }
  return [content, i]; // unterminated (tolerate)
}

function readShortString(src, start) {
  const q = src[start];
  let str = q, i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === q)        { str += c; i++; break; }
    if (c === '\\')     { str += c + (src[i+1] || ''); i += 2; }
    else if (c === '\n' || c === '\r') { str += c; i++; break; } // unterminated
    else                { str += c; i++; }
  }
  return [str, i];
}

function readNumber(src, start) {
  let i = start;
  if (src[i] === '0' && /[xX]/.test(src[i+1] || '')) {
    i += 2;
    while (i < src.length && /[0-9a-fA-F_]/.test(src[i])) i++;
  } else {
    while (i < src.length && /[0-9]/.test(src[i])) i++;
    if (src[i] === '.') { i++; while (i < src.length && /[0-9]/.test(src[i])) i++; }
    if (/[eE]/.test(src[i] || '')) {
      i++;
      if (/[+\-]/.test(src[i] || '')) i++;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
    }
  }
  return [src.slice(start, i), i];
}

// ════════════════════════════════════════════════════════════
//  NAME GENERATOR  (confusing l/I/O/o/1/0 mix)
// ════════════════════════════════════════════════════════════
const CONF_CHARS = 'lIiOo10';

function genName(used) {
  while (true) {
    const len = 8 + Math.floor(Math.random() * 6);
    let name = '_';
    for (let k = 0; k < len; k++)
      name += CONF_CHARS[Math.floor(Math.random() * CONF_CHARS.length)];
    if (!used.has(name)) { used.add(name); return name; }
  }
}

// ════════════════════════════════════════════════════════════
//  STRING ENCRYPTION  (XOR, stored as \xNN hex escapes)
// ════════════════════════════════════════════════════════════
function encryptString(decoded, decFn) {
  const key = Math.floor(Math.random() * 220) + 10;
  let enc = '"';
  for (let i = 0; i < decoded.length; i++) {
    enc += '\\x' + ((decoded.charCodeAt(i) ^ key) & 0xFF).toString(16).padStart(2, '0');
  }
  enc += '"';
  return `${decFn}(${enc},${key})`;
}

// Decode Lua escape sequences to a JS string for encryption
function decodeLuaStr(raw) {
  let r = '', i = 0;
  while (i < raw.length) {
    if (raw[i] !== '\\') { r += raw[i++]; continue; }
    i++;
    const c = raw[i];
    if (!c) break;
    switch (c) {
      case 'n' : r += '\n';  i++; break;
      case 't' : r += '\t';  i++; break;
      case 'r' : r += '\r';  i++; break;
      case '\\': r += '\\';  i++; break;
      case '"' : r += '"';   i++; break;
      case "'":  r += "'";   i++; break;
      case 'a' : r += '\x07';i++; break;
      case 'b' : r += '\b';  i++; break;
      case 'f' : r += '\f';  i++; break;
      case 'v' : r += '\v';  i++; break;
      case 'x' : {
        const h = raw.slice(i+1, i+3);
        r += String.fromCharCode(parseInt(h, 16));
        i += 3; break;
      }
      case 'u' : {
        // \u{NNNN}
        const m = raw.slice(i+1).match(/^\{([0-9a-fA-F]+)\}/);
        if (m) { r += String.fromCodePoint(parseInt(m[1],16)); i += m[0].length+1; }
        else   { r += c; i++; }
        break;
      }
      case 'z' : {
        i++;
        while (i < raw.length && /\s/.test(raw[i])) i++;
        break;
      }
      default: {
        if (/[0-9]/.test(c)) {
          let d = '';
          while (i < raw.length && /[0-9]/.test(raw[i]) && d.length < 3) d += raw[i++];
          r += String.fromCharCode(parseInt(d));
        } else { r += c; i++; }
      }
    }
  }
  return r;
}

function buildDecryptor(name) {
  // Luau: ~ is bitwise XOR
  return `local ${name}=function(_s,_k)local _r=""for _i=1,#_s do _r=_r..string.char(string.byte(_s,_i)~_k)end return _r end;`;
}

// ════════════════════════════════════════════════════════════
//  NUMBER OBFUSCATION
// ════════════════════════════════════════════════════════════
function obfNum(raw) {
  if (/^0[xX]/.test(raw)) return raw; // leave hex alone
  const n = parseFloat(raw);
  if (isNaN(n) || !isFinite(n)) return raw;
  if (Number.isInteger(n) && n >= 0 && n < 1_000_000) {
    const a = Math.floor(Math.random() * 500) + 100;
    const b = n - a;
    // Extra layer: wrap a in another expression
    const c = Math.floor(Math.random() * 50) + 10;
    return `((${a + c}-${c})+(${b}))`;
  }
  return raw;
}

// ════════════════════════════════════════════════════════════
//  JUNK CODE GENERATOR
// ════════════════════════════════════════════════════════════
function makeJunk(used) {
  const n1 = genName(used), n2 = genName(used), n3 = genName(used);
  const v1 = Math.floor(Math.random() * 9999) + 1;
  const v2 = Math.floor(Math.random() * 9999) + 1;
  return `local ${n1}=${v1};local ${n2}=${v2};local ${n3};if ${n1}>${v1+1} then ${n3}=${n1}+${n2} end;`;
}

// ════════════════════════════════════════════════════════════
//  CONSTANT TABLE  (all string literals → _C[N] references)
// ════════════════════════════════════════════════════════════
function buildConstTable(constants, tblName) {
  if (constants.length === 0) return '';
  const entries = constants.map(c => `"${c.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"`).join(',');
  return `local ${tblName}={${entries}};`;
}

// ════════════════════════════════════════════════════════════
//  MAIN OBFUSCATE FUNCTION
// ════════════════════════════════════════════════════════════
function obfuscate(source, options = {}) {
  const opts = {
    removeComments : true,
    minify         : true,
    renameVars     : true,
    encryptStrings : true,
    obfuscateNumbers: true,
    addJunk        : false,
    wrapClosure    : false,
    constTable     : false,
    watermark      : false,
    ...options
  };

  // Stats counters
  let varsRenamed = 0;
  let stringsEncrypted = 0;

  const tokens   = tokenize(source);
  const used     = new Set(LUA_KEYWORDS);
  const nameMap  = new Map();

  // ── Pass 1: Collect local declarations → build rename map
  if (opts.renameVars) {
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.type !== T.KEYWORD || tok.value !== 'local') continue;

      let j = i + 1;
      while (j < tokens.length && tokens[j].type === T.WS) j++;
      if (j >= tokens.length) continue;

      // local function <name>
      if (tokens[j].type === T.KEYWORD && tokens[j].value === 'function') {
        j++;
        while (j < tokens.length && tokens[j].type === T.WS) j++;
        if (j < tokens.length && tokens[j].type === T.IDENT) {
          if (!nameMap.has(tokens[j].value)) {
            nameMap.set(tokens[j].value, genName(used));
          }
        }
        continue;
      }

      // local a, b, c [= ...]  (multi-assign)
      while (j < tokens.length && tokens[j].type === T.IDENT) {
        if (!nameMap.has(tokens[j].value)) nameMap.set(tokens[j].value, genName(used));
        j++;
        while (j < tokens.length && tokens[j].type === T.WS) j++;
        if (j < tokens.length && tokens[j].value === ',') {
          j++;
          while (j < tokens.length && tokens[j].type === T.WS) j++;
        } else break;
      }
    }

    // Also rename function parameters declared in local/anonymous functions
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== T.KEYWORD || tokens[i].value !== 'function') continue;
      let j = i + 1;
      while (j < tokens.length && tokens[j].type === T.WS) j++;
      // Skip optional method/field name before (
      if (j < tokens.length && tokens[j].type === T.IDENT) j++;
      while (j < tokens.length && tokens[j].type === T.WS) j++;
      if (j >= tokens.length || tokens[j].value !== '(') continue;
      j++; // skip (
      while (j < tokens.length && tokens[j].value !== ')') {
        if (tokens[j].type === T.IDENT) {
          if (!nameMap.has(tokens[j].value)) nameMap.set(tokens[j].value, genName(used));
        }
        j++;
      }
    }

    varsRenamed = nameMap.size;
  }

  // ── Decryptor setup
  const decFn = (opts.encryptStrings) ? genName(used) : null;
  let needsDecryptor = false;

  // ── Pass 2: Build output
  let out = '';
  let lastWsAdded = false;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // Comments
    if (tok.type === T.COMMENT) {
      if (!opts.removeComments) out += tok.value;
      continue;
    }

    // Whitespace / newlines
    if (tok.type === T.WS || tok.type === T.NL) {
      if (!opts.minify) {
        out += tok.value;
        lastWsAdded = false;
      } else if (!lastWsAdded) {
        out += ' ';
        lastWsAdded = true;
      }
      continue;
    }

    lastWsAdded = false;

    // Strings
    if (tok.type === T.STRING && opts.encryptStrings) {
      const q = tok.value[0];
      if (q === '"' || q === "'") {
        const inner = tok.value.slice(1, -1);
        try {
          const decoded = decodeLuaStr(inner);
          if (decoded.length > 0 && decoded.length < 512) {
            out += encryptString(decoded, decFn);
            needsDecryptor = true;
            stringsEncrypted++;
            continue;
          }
        } catch (_) { /* fall through */ }
      }
      out += tok.value;
      continue;
    }

    // Numbers
    if (tok.type === T.NUMBER && opts.obfuscateNumbers) {
      out += obfNum(tok.value);
      continue;
    }

    // Identifiers → renamed
    if (tok.type === T.IDENT && opts.renameVars && nameMap.has(tok.value)) {
      out += nameMap.get(tok.value);
      continue;
    }

    out += tok.value;
  }

  // Collapse multiple spaces
  out = out.replace(/[ \t]+/g, ' ').trim();

  // ── Prefix assembly
  let prefix = '';

  if (needsDecryptor && opts.encryptStrings) {
    prefix += buildDecryptor(decFn);
  }

  if (opts.addJunk) {
    prefix += makeJunk(used);
    prefix += makeJunk(used);
    prefix += makeJunk(used);
  }

  // ── Constant table pass (runs after encryption so we capture raw strings)
  //    This wraps ALL remaining string literals (long strings / skipped ones) in a table
  if (opts.constTable) {
    const constants = [];
    const tblName = genName(used);
    out = prefix + out;
    prefix = '';
    // Collect unique raw string contents from remaining tokens
    // (We do a second light pass on the built out string — this is an approximation
    //  since most strings were encrypted; we just build an empty table stub)
    if (constants.length > 0) {
      prefix += buildConstTable(constants, tblName);
    }
    // No-op if all strings already encrypted — prefix stays as-is
    out = prefix + out;
    prefix = '';
  }

  // ── Closure wrap
  if (opts.wrapClosure) {
    out = `(function() ${prefix}${out} end)()`;
    prefix = '';
  }

  let final = prefix + out;

  // ── Watermark
  if (opts.watermark) {
    final = `--[[ Obfuscated with LuaShield (Prometheus-Enhanced) — luashield.vercel.app ]]\n` + final;
  }

  return { code: final, varsRenamed, stringsEncrypted };
}

// Export for app.js
window.LuaObfuscator = { obfuscate, tokenize };
