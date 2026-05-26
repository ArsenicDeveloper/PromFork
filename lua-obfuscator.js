'use strict';
// ════════════════════════════════════════════════════════════
//  LuaShield v2  —  Prometheus-Fork Obfuscation Engine
//  Techniques:
//    • Scope-depth-aware variable renaming
//    • String Table Virtualisation  (_S[N] references)
//    • XOR-based number encoding
//    • Opaque predicate injection
//    • Global proxy table
//    • Closure wrap / anti-tamper
// ════════════════════════════════════════════════════════════

// ── Token types ───────────────────────────────────────────────────────────────
const T = {
  COMMENT:'COMMENT', STRING:'STRING', NUMBER:'NUMBER',
  KEYWORD:'KEYWORD', IDENT:'IDENT',   OP:'OP',
  WS:'WS',           NL:'NL',         OTHER:'OTHER'
};

const LUA_KEYWORDS = new Set([
  'and','break','do','else','elseif','end','false','for',
  'function','goto','if','in','local','nil','not','or',
  'repeat','return','then','true','until','while'
]);

// Globals that must never be renamed (Lua stdlib + Roblox API)
const SAFE_GLOBALS = new Set([
  'print','warn','error','assert','type','tostring','tonumber',
  'pairs','ipairs','next','select','unpack','rawget','rawset',
  'rawequal','rawlen','setmetatable','getmetatable','pcall','xpcall',
  'require','load','loadstring','dofile','collectgarbage',
  'coroutine','string','table','math','io','os','debug',
  'bit32','bit','utf8',
  'game','workspace','script','wait','spawn','delay','tick','time',
  'task','shared','_G','_VERSION',
  'Instance','Enum','Vector3','Vector2','CFrame','Color3',
  'UDim','UDim2','Ray','Region3','BrickColor','TweenInfo',
  'NumberSequence','ColorSequence','NumberRange','Rect',
  'true','false','nil',
  'RunService','Players','ReplicatedStorage','ServerStorage',
  'ServerScriptService','StarterGui','StarterPlayer','StarterPack',
  'SoundService','TweenService','UserInputService',
  'ContextActionService','HttpService','DataStoreService',
]);

// ═════════════════════════════════════════════════════════════
//  LEXER
// ═════════════════════════════════════════════════════════════
class Token {
  constructor(type, value) { this.type = type; this.value = value; }
}

function tokenize(src) {
  const toks = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    // Newlines
    if (ch === '\n') { toks.push(new Token(T.NL,'\n')); i++; continue; }
    if (ch === '\r') {
      const s = src[i+1] === '\n' ? '\r\n' : '\r';
      toks.push(new Token(T.NL, s)); i += s.length; continue;
    }

    // Whitespace
    if (ch === ' ' || ch === '\t') {
      let ws = '';
      while (i < len && (src[i] === ' ' || src[i] === '\t')) ws += src[i++];
      toks.push(new Token(T.WS, ws)); continue;
    }

    // Comments
    if (ch === '-' && src[i+1] === '-') {
      i += 2;
      if (src[i] === '[') {
        const lvl = longLevel(src, i);
        if (lvl >= 0) {
          i += lvl + 2;
          const [body, end] = longBody(src, i, lvl);
          toks.push(new Token(T.COMMENT, '--' + '[' + '='.repeat(lvl) + '[' + body));
          i = end; continue;
        }
      }
      let cmt = '--';
      while (i < len && src[i] !== '\n' && src[i] !== '\r') cmt += src[i++];
      toks.push(new Token(T.COMMENT, cmt)); continue;
    }

    // Long strings
    if (ch === '[' && (src[i+1] === '[' || src[i+1] === '=')) {
      const saved = i, lvl = longLevel(src, i);
      if (lvl >= 0) {
        i += lvl + 2;
        const [body, end] = longBody(src, i, lvl);
        toks.push(new Token(T.STRING, '[' + '='.repeat(lvl) + '[' + body));
        i = end; continue;
      }
      i = saved;
    }

    // Short strings
    if (ch === '"' || ch === "'") {
      const [s, end] = shortStr(src, i);
      toks.push(new Token(T.STRING, s)); i = end; continue;
    }

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i+1] || ''))) {
      const [n, end] = readNum(src, i);
      toks.push(new Token(T.NUMBER, n)); i = end; continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let id = '';
      while (i < len && /[a-zA-Z0-9_]/.test(src[i])) id += src[i++];
      toks.push(new Token(LUA_KEYWORDS.has(id) ? T.KEYWORD : T.IDENT, id));
      continue;
    }

    // Multi-char operators
    const t3 = src.slice(i, i+3);
    if (t3 === '...') { toks.push(new Token(T.OP, '...')); i += 3; continue; }
    const t2 = src.slice(i, i+2);
    if (['==','~=','<=','>=','..','::','//','<<','>>'].includes(t2)) {
      toks.push(new Token(T.OP, t2)); i += 2; continue;
    }

    toks.push(new Token(T.OTHER, src[i++]));
  }
  return toks;
}

function longLevel(src, i) {
  if (src[i] !== '[') return -1;
  let lvl = 0, j = i + 1;
  while (j < src.length && src[j] === '=') { lvl++; j++; }
  return src[j] === '[' ? lvl : -1;
}

function longBody(src, start, lvl) {
  const close = ']' + '='.repeat(lvl) + ']';
  let i = start;
  if (src[i] === '\n') i++;
  else if (src[i] === '\r') { i++; if (src[i] === '\n') i++; }
  let body = '';
  while (i < src.length) {
    if (src.startsWith(close, i)) return [body, i + close.length];
    body += src[i++];
  }
  return [body, i];
}

function shortStr(src, start) {
  const q = src[start]; let s = q, i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === q) { s += c; i++; break; }
    if (c === '\\') { s += c + (src[i+1] || ''); i += 2; }
    else if (c === '\n' || c === '\r') { s += c; i++; break; }
    else { s += c; i++; }
  }
  return [s, i];
}

function readNum(src, start) {
  let i = start;
  if (src[i] === '0' && /[xX]/.test(src[i+1] || '')) {
    i += 2; while (i < src.length && /[0-9a-fA-F_]/.test(src[i])) i++;
  } else {
    while (i < src.length && /[0-9]/.test(src[i])) i++;
    if (src[i] === '.') { i++; while (i < src.length && /[0-9]/.test(src[i])) i++; }
    if (/[eE]/.test(src[i] || '')) {
      i++; if (/[+\-]/.test(src[i] || '')) i++;
      while (i < src.length && /[0-9]/.test(src[i])) i++;
    }
  }
  return [src.slice(start, i), i];
}

// ═════════════════════════════════════════════════════════════
//  SCOPE DEPTH ANALYSIS
//  Computes an integer scope-depth at every token position.
//  Rules:
//    depth++ after: do  then  function  repeat
//    depth += 0  for: else elseif  (pop current, push sibling)
//    depth-- after: end  until
// ═════════════════════════════════════════════════════════════
function computeDepths(tokens) {
  const depths = new Int32Array(tokens.length);
  let d = 0;
  for (let i = 0; i < tokens.length; i++) {
    depths[i] = d;
    const { type, value } = tokens[i];
    if (type !== T.KEYWORD) continue;
    switch (value) {
      case 'do': case 'then': case 'function': case 'repeat': d++; break;
      case 'end': case 'until': if (d > 0) d--; break;
      // else / elseif: close current branch, re-open same level
      // net depth change = 0; handled naturally
    }
  }
  return depths;
}

// ═════════════════════════════════════════════════════════════
//  LOCAL DECLARATION COLLECTOR
//  Returns [{name, newName, depth, pos}]
// ═════════════════════════════════════════════════════════════
function collectLocals(tokens, depths, used) {
  const decls = [];
  const register = (name, depth, pos) => {
    if (SAFE_GLOBALS.has(name) || LUA_KEYWORDS.has(name)) return;
    decls.push({ name, newName: genName(used), depth, pos });
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type !== T.KEYWORD) continue;

    // ── local var [, var2 ...] ─────────────────────────────
    if (tok.value === 'local') {
      let j = skipWS(tokens, i + 1);
      if (j >= tokens.length) continue;

      // local function <name>
      if (tokens[j].type === T.KEYWORD && tokens[j].value === 'function') {
        j = skipWS(tokens, j + 1);
        if (j < tokens.length && tokens[j].type === T.IDENT)
          register(tokens[j].value, depths[j], j);
        continue;
      }

      // local a, b, c
      while (j < tokens.length && tokens[j].type === T.IDENT) {
        register(tokens[j].value, depths[j], j);
        j = skipWS(tokens, j + 1);
        if (j < tokens.length && tokens[j].value === ',') j = skipWS(tokens, j + 1);
        else break;
      }
      continue;
    }

    // ── function params (anonymous or named) ──────────────
    if (tok.value === 'function') {
      let j = skipWS(tokens, i + 1);
      // skip optional name (and method name e.g. obj:method)
      while (j < tokens.length && tokens[j].type === T.IDENT) j = skipWS(tokens, j + 1);
      if (j < tokens.length && tokens[j].value === ':') {
        j = skipWS(tokens, j + 1);
        if (j < tokens.length && tokens[j].type === T.IDENT) j = skipWS(tokens, j + 1);
      }
      if (j >= tokens.length || tokens[j].value !== '(') continue;
      j++;
      while (j < tokens.length && tokens[j].value !== ')') {
        if (tokens[j].type === T.IDENT)
          register(tokens[j].value, depths[j], j);
        j++;
      }
      continue;
    }

    // ── for-loop variables ─────────────────────────────────
    if (tok.value === 'for') {
      let j = skipWS(tokens, i + 1);
      while (j < tokens.length && tokens[j].type === T.IDENT) {
        // for vars are visible from 'do' onward (depth+1 of 'for')
        register(tokens[j].value, depths[i] + 1, j);
        j = skipWS(tokens, j + 1);
        if (j < tokens.length && tokens[j].value === ',') j = skipWS(tokens, j + 1);
        else break;
      }
      continue;
    }
  }
  return decls;
}

function skipWS(tokens, i) {
  while (i < tokens.length && tokens[i].type === T.WS) i++;
  return i;
}

// ── Resolve the innermost local declaration for (name, pos, depth) ─────────
function resolveLocal(decls, name, pos, depth) {
  let best = null;
  for (const d of decls) {
    if (d.name !== name || d.pos >= pos || d.depth > depth) continue;
    if (!best || d.depth > best.depth || (d.depth === best.depth && d.pos > best.pos))
      best = d;
  }
  return best?.newName ?? null;
}

// ═════════════════════════════════════════════════════════════
//  NAME GENERATOR  — confusing l/I/O/o/1/0 mix
// ═════════════════════════════════════════════════════════════
const GCHARS = 'lIiOo10';
function genName(used) {
  while (true) {
    const len = 9 + (Math.random() * 7 | 0);
    let n = '_';
    for (let k = 0; k < len; k++) n += GCHARS[Math.random() * GCHARS.length | 0];
    if (!used.has(n)) { used.add(n); return n; }
  }
}
function rand(lo, hi) { return lo + (Math.random() * (hi - lo + 1) | 0); }

// ═════════════════════════════════════════════════════════════
//  STRING TABLE VIRTUALISATION
//  All short strings → encrypted → stored in _S = {...}
//  Replaced inline as _S[N]
// ═════════════════════════════════════════════════════════════
function decodeLuaStr(raw) {
  let r = '', i = 0;
  while (i < raw.length) {
    if (raw[i] !== '\\') { r += raw[i++]; continue; }
    i++;
    const c = raw[i];
    switch (c) {
      case 'n': r += '\n'; i++; break;
      case 't': r += '\t'; i++; break;
      case 'r': r += '\r'; i++; break;
      case '\\': r += '\\'; i++; break;
      case '"': r += '"'; i++; break;
      case "'": r += "'"; i++; break;
      case 'a': r += '\x07'; i++; break;
      case 'b': r += '\b'; i++; break;
      case 'f': r += '\f'; i++; break;
      case 'v': r += '\v'; i++; break;
      case 'x': {
        r += String.fromCharCode(parseInt(raw.slice(i+1, i+3), 16));
        i += 3; break;
      }
      case 'z': { i++; while (i < raw.length && /\s/.test(raw[i])) i++; break; }
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

function xorEncrypt(plain, key) {
  let out = '"';
  for (let i = 0; i < plain.length; i++)
    out += '\\x' + ((plain.charCodeAt(i) ^ key) & 0xFF).toString(16).padStart(2, '0');
  return out + '"';
}

function buildStringTable(tokens) {
  const map  = new Map();  // decoded → {index, key}
  const list = [];         // in order
  for (const tok of tokens) {
    if (tok.type !== T.STRING) continue;
    const q = tok.value[0];
    if (q !== '"' && q !== "'") continue;
    const inner = tok.value.slice(1, -1);
    try {
      const plain = decodeLuaStr(inner);
      if (plain.length === 0 || plain.length > 384) continue;
      if (!map.has(plain)) {
        const key = rand(5, 249);
        map.set(plain, { index: list.length + 1, key });
        list.push({ plain, key });
      }
    } catch (_) {}
  }
  return { map, list };
}

function emitStringTable(list, decFnName, tblName) {
  if (list.length === 0) return '';
  const entries = list.map(({ plain, key }) => `${decFnName}(${xorEncrypt(plain, key)},${key})`).join(',');
  return `local ${decFnName}=function(_s,_k)local _r=""for _i=1,#_s do _r=_r..string.char(string.byte(_s,_i)~_k)end return _r end;` +
         `local ${tblName}={${entries}};`;
}

// ═════════════════════════════════════════════════════════════
//  NUMBER ENCODING  — Prometheus XOR technique
//  N  →  (A ~ B)   where A XOR B = N
//        wrapped in a second layer for extra depth
// ═════════════════════════════════════════════════════════════
function encodeNumber(raw) {
  if (/^0[xX]/.test(raw)) return raw;
  const n = parseFloat(raw);
  if (!Number.isInteger(n) || n < 0 || n > 0xFFFFFF || !isFinite(n)) return raw;

  // Layer 1: N = A XOR B
  const A = rand(256, 65535);
  const B = A ^ n;
  // Layer 2: A = C XOR D
  const C = rand(128, 8191);
  const D = C ^ A;
  // Emit: ((C~D)~B)
  return `((${C}~${D})~${B})`;
}

// ═════════════════════════════════════════════════════════════
//  OPAQUE PREDICATES
//  Dead code blocks that are never executed but look real
// ═════════════════════════════════════════════════════════════
function opaqueBlock(used) {
  const n1 = genName(used), n2 = genName(used), n3 = genName(used);
  const v  = rand(100, 9999);
  // NaN never equals itself — always false
  return `local ${n1}=math.huge*0;local ${n2}=${v};local ${n3};` +
         `if ${n1}==${n1} then ${n3}=${n2}*0 end;`;
}

// ═════════════════════════════════════════════════════════════
//  GLOBAL PROXY TABLE
//  local _G2 = {print=print, math=math, ...}
//  Then references become _G2.print(...)
//  Makes static analysis of global usage harder
// ═════════════════════════════════════════════════════════════
function buildProxyTable(usedGlobals, proxyName) {
  const keys = [...usedGlobals].filter(g => SAFE_GLOBALS.has(g));
  if (keys.length === 0) return { code: '', map: new Map() };
  const entries = keys.map(k => `${k}=${k}`).join(',');
  const map = new Map(keys.map(k => [k, `${proxyName}.${k}`]));
  return { code: `local ${proxyName}={${entries}};`, map };
}

// ═════════════════════════════════════════════════════════════
//  CONTROL FLOW OBFUSCATION
//  Wraps the body in a numeric-dispatch while loop.
//  Simple version: all code in state 1, sentinel in state 2.
// ═════════════════════════════════════════════════════════════
function wrapControlFlow(code, used) {
  const state = genName(used);
  const k     = rand(1, 9999);
  // We rotate the state key so the initial value isn't obviously 1
  const start = rand(2, 255);
  const real  = start ^ k ^ 1;  // real state = start XOR k = 1 effectively
  return `local ${state}=${real};while true do if ${state}==(${start}~${k}) then ${code};${state}=${start}~${k}~1 elseif ${state}==(${start}~${k}~1) then break end end`;
}

// ═════════════════════════════════════════════════════════════
//  JUNK CODE INJECTION
// ═════════════════════════════════════════════════════════════
function junkBlock(used) {
  const n = [genName(used), genName(used), genName(used)];
  const v = rand(1000, 99999);
  return `local ${n[0]}=${encodeNumber(String(v))};local ${n[1]}=${encodeNumber(String(v + 1))};` +
         `local ${n[2]};if ${n[0]}>${n[1]} then ${n[2]}=${n[0]} end;`;
}

// ═════════════════════════════════════════════════════════════
//  MAIN OBFUSCATE FUNCTION
// ═════════════════════════════════════════════════════════════
function obfuscate(source, options = {}) {
  const opts = {
    removeComments   : true,
    minify           : true,
    renameVars       : true,
    stringTable      : true,
    encodeNumbers    : true,
    opaquePredicates : false,
    injectJunk       : false,
    proxyGlobals     : false,
    controlFlow      : false,
    closureWrap      : false,
    antiTamper       : false,
    watermark        : false,
    ...options
  };

  // ── Tokenise ─────────────────────────────────────────────
  const tokens = tokenize(source);
  const used   = new Set(LUA_KEYWORDS);

  // ── Scope depths ─────────────────────────────────────────
  const depths = computeDepths(tokens);

  // ── Collect locals ────────────────────────────────────────
  const decls = opts.renameVars ? collectLocals(tokens, depths, used) : [];

  // ── String table ─────────────────────────────────────────
  const { map: strMap, list: strList } = opts.stringTable
    ? buildStringTable(tokens)
    : { map: new Map(), list: [] };

  const decFnName = strList.length > 0 ? genName(used) : null;
  const tblName   = strList.length > 0 ? genName(used) : null;

  // ── Detect which globals are actually used ─────────────────
  const usedGlobals = new Set();
  if (opts.proxyGlobals) {
    for (const tok of tokens)
      if (tok.type === T.IDENT && SAFE_GLOBALS.has(tok.value))
        usedGlobals.add(tok.value);
  }
  const proxyName = opts.proxyGlobals ? genName(used) : null;
  const { code: proxyCode, map: proxyMap } = opts.proxyGlobals
    ? buildProxyTable(usedGlobals, proxyName)
    : { code: '', map: new Map() };

  // ── Code generation ───────────────────────────────────────
  let out = '';
  let lastWS = false;
  let strEncCount = 0;
  let varRenCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const dep = depths[i];

    // Comments
    if (tok.type === T.COMMENT) {
      if (!opts.removeComments) out += tok.value;
      continue;
    }

    // Whitespace / newlines
    if (tok.type === T.WS || tok.type === T.NL) {
      if (!opts.minify) { out += tok.value; lastWS = false; }
      else if (!lastWS)  { out += ' '; lastWS = true; }
      continue;
    }
    lastWS = false;

    // ── Strings → table lookup ────────────────────────────
    if (tok.type === T.STRING && opts.stringTable && strMap.size > 0) {
      const q = tok.value[0];
      if (q === '"' || q === "'") {
        const inner = tok.value.slice(1, -1);
        try {
          const plain = decodeLuaStr(inner);
          const entry = strMap.get(plain);
          if (entry) {
            out += `${tblName}[${entry.index}]`;
            strEncCount++;
            continue;
          }
        } catch (_) {}
      }
      out += tok.value;
      continue;
    }

    // ── Numbers → XOR encoding ───────────────────────────
    if (tok.type === T.NUMBER && opts.encodeNumbers) {
      out += encodeNumber(tok.value);
      continue;
    }

    // ── Identifiers → rename + proxy ─────────────────────
    if (tok.type === T.IDENT) {
      // Proxy globals
      if (opts.proxyGlobals && proxyMap.has(tok.value)) {
        out += proxyMap.get(tok.value);
        continue;
      }
      // Local rename
      if (opts.renameVars) {
        const renamed = resolveLocal(decls, tok.value, i, dep);
        if (renamed) {
          out += renamed;
          varRenCount++;
          continue;
        }
      }
    }

    out += tok.value;
  }

  // Collapse spaces
  out = out.replace(/[ \t]+/g, ' ').trim();

  // ── Assemble prefix ───────────────────────────────────────
  let prefix = '';

  // String decryptor + table
  if (strList.length > 0 && opts.stringTable)
    prefix += emitStringTable(strList, decFnName, tblName);

  // Proxy table
  if (opts.proxyGlobals && proxyCode)
    prefix += proxyCode;

  // Opaque predicates
  if (opts.opaquePredicates)
    prefix += opaqueBlock(used) + opaqueBlock(used);

  // Junk blocks
  if (opts.injectJunk)
    prefix += junkBlock(used) + junkBlock(used) + junkBlock(used);

  // ── Anti-tamper ───────────────────────────────────────────
  let antiTamper = '';
  if (opts.antiTamper) {
    const errFn = genName(used), chk = genName(used);
    antiTamper =
      `local ${errFn}=function()error("Script integrity check failed",0)end;` +
      `local ${chk}=pcall(function()if not game or not game:GetService then ${errFn}() end end);` +
      `if not ${chk} then ${errFn}() end;`;
  }

  // ── Control flow wrap ─────────────────────────────────────
  let body = prefix + antiTamper + out;

  if (opts.controlFlow)
    body = wrapControlFlow(body, used);

  // ── Closure wrap ─────────────────────────────────────────
  if (opts.closureWrap)
    body = `(function() ${body} end)()`;

  // ── Watermark ─────────────────────────────────────────────
  if (opts.watermark)
    body = `--[[ Obfuscated with LuaShield v2 (Prometheus-Fork) ]]\n` + body;

  return {
    code          : body,
    varsRenamed   : varRenCount,
    stringsEncrypted : strEncCount,
    stringTableSize  : strList.length,
  };
}

// ── Export ────────────────────────────────────────────────────
window.LuaObfuscator = { obfuscate, tokenize };
