// ════════════════════════════════════════════════════════════
//  LuaShield v2 — App / UI
// ════════════════════════════════════════════════════════════

const inputEl   = document.getElementById('input-code');
const outputEl  = document.getElementById('output-code');
const btnObf    = document.getElementById('btn-obfuscate');
const btnObfTxt = document.getElementById('btn-obf-text');
const btnCopy   = document.getElementById('btn-copy');
const btnDl     = document.getElementById('btn-download');
const btnClear  = document.getElementById('btn-clear');
const btnSample = document.getElementById('btn-sample');
const toast     = document.getElementById('toast');
const statsCard = document.getElementById('stats-card');
const lnIn      = document.getElementById('line-numbers-in');
const lnOut     = document.getElementById('line-numbers-out');

// ── Sample (TSB-style) ────────────────────────────────────────
const SAMPLE = `-- TSB Auto-Combo Script
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local LocalPlayer = Players.LocalPlayer
local Character = LocalPlayer.Character or LocalPlayer.CharacterAdded:Wait()
local HRP = Character:WaitForChild("HumanoidRootPart")
local Humanoid = Character:WaitForChild("Humanoid")

local dashDelay = 0.15
local comboMax = 5
local attackPower = 1.75
local playerTag = "TSBScript"
local enabled = true

local function getNearest(range)
    local best, bestDist = nil, range
    for _, p in ipairs(Players:GetPlayers()) do
        if p ~= LocalPlayer and p.Character then
            local h = p.Character:FindFirstChild("HumanoidRootPart")
            if h then
                local d = (HRP.Position - h.Position).Magnitude
                if d < bestDist then bestDist = d; best = p end
            end
        end
    end
    return best
end

local function fireDash(dir)
    local rs = game:GetService("ReplicatedStorage")
    rs.Resources.Brother["#Friend"].Communicate:FireServer({ Dash = dir })
end

local combo = 0
local lastFire = 0

RunService.Heartbeat:Connect(function()
    if not enabled then return end
    local now = tick()
    if now - lastFire < dashDelay then return end
    local enemy = getNearest(20)
    if enemy then
        fireDash(Enum.KeyCode.W)
        combo = (combo % comboMax) + 1
        lastFire = now
    end
end)

print("Loaded: " .. playerTag)
print("Power: " .. tostring(attackPower))
`;

// ── Level presets  (use v2 option names) ─────────────────────
const LEVELS = {
  1: {
    removeComments:false, minify:true,
    renameVars:false, stringTable:false, encodeNumbers:false,
    opaquePredicates:false, injectJunk:false, proxyGlobals:false,
    controlFlow:false, closureWrap:false, antiTamper:false
  },
  2: {
    removeComments:true,  minify:true,
    renameVars:true,  stringTable:true,  encodeNumbers:true,
    opaquePredicates:false, injectJunk:false, proxyGlobals:false,
    controlFlow:false, closureWrap:false, antiTamper:false
  },
  3: {
    removeComments:true,  minify:true,
    renameVars:true,  stringTable:true,  encodeNumbers:true,
    opaquePredicates:true, injectJunk:true, proxyGlobals:true,
    controlFlow:true,  closureWrap:true,  antiTamper:true
  }
};

// Map checkbox IDs → v2 option keys
const OPT_MAP = {
  'opt-comments'  : 'removeComments',
  'opt-minify'    : 'minify',
  'opt-rename'    : 'renameVars',
  'opt-strings'   : 'stringTable',       // ← was encryptStrings
  'opt-numbers'   : 'encodeNumbers',     // ← was obfuscateNumbers
  'opt-opaque'    : 'opaquePredicates',
  'opt-junk'      : 'injectJunk',        // ← was addJunk
  'opt-proxy'     : 'proxyGlobals',
  'opt-cflow'     : 'controlFlow',
  'opt-closure'   : 'closureWrap',       // ← was wrapClosure
  'opt-antitamper': 'antiTamper',
  'opt-watermark' : 'watermark'
};

function getOptions() {
  const opts = {};
  for (const [id, key] of Object.entries(OPT_MAP)) {
    const el = document.getElementById(id);
    if (el) opts[key] = el.checked;
  }
  return opts;
}

function applyLevel(n) {
  const p = LEVELS[n];
  for (const [id, key] of Object.entries(OPT_MAP)) {
    const el = document.getElementById(id);
    if (el && key in p) el.checked = p[key];
  }
}

// ── Level buttons ─────────────────────────────────────────────
document.querySelectorAll('.lvl-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lvl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyLevel(+btn.dataset.level);
  });
});

// ── Line numbers ──────────────────────────────────────────────
function updateLN(ta, ln) {
  const n = ta.value.split('\n').length;
  ln.textContent = Array.from({length:n}, (_,i) => i+1).join('\n');
}
function syncScroll(ta, ln) { ln.scrollTop = ta.scrollTop; }

inputEl.addEventListener('input',  () => { updateLN(inputEl, lnIn); updateInStat(); });
inputEl.addEventListener('scroll', () => syncScroll(inputEl, lnIn));
outputEl.addEventListener('scroll',() => syncScroll(outputEl, lnOut));

function updateInStat() {
  const v = inputEl.value;
  document.getElementById('stat-in').textContent =
    `${v.split('\n').length} lines · ${v.length} chars`;
}
function updateOutStat() {
  const v = outputEl.value;
  document.getElementById('stat-out').textContent =
    `${v.split('\n').length} lines · ${v.length} chars`;
}

// ── Obfuscate ─────────────────────────────────────────────────
btnObf.addEventListener('click', () => {
  const src = inputEl.value.trim();
  if (!src) { showToast('Paste some Lua code first'); return; }

  btnObf.disabled  = true;
  btnObfTxt.innerHTML = '<span class="loading">Working…</span>';

  setTimeout(() => {
    try {
      const result = window.LuaObfuscator.obfuscate(src, getOptions());

      outputEl.value = result.code;
      updateLN(outputEl, lnOut);
      updateOutStat();

      const ratio = src.length > 0
        ? ((result.code.length / src.length) * 100).toFixed(0) + '%'
        : '—';

      document.getElementById('stat-before').textContent   = fmt(src.length);
      document.getElementById('stat-after').textContent    = fmt(result.code.length);
      document.getElementById('stat-ratio').textContent    = ratio;
      document.getElementById('stat-vars').textContent     = result.varsRenamed;
      document.getElementById('stat-strings').textContent  =
        `${result.stringsEncrypted} (table: ${result.stringTableSize})`;

      statsCard.classList.add('visible');
      showToast('✓ Done');

    } catch(e) {
      outputEl.value = `-- [LuaShield Error]\n-- ${e.message}`;
      updateLN(outputEl, lnOut);
      console.error(e);
      showToast('Error — see output');
    }
    btnObf.disabled = false;
    btnObfTxt.textContent = 'Obfuscate';
  }, 30);
});

// ── Copy ──────────────────────────────────────────────────────
btnCopy.addEventListener('click', () => {
  if (!outputEl.value) return;
  navigator.clipboard.writeText(outputEl.value)
    .then(() => showToast('▲ Copied'))
    .catch(() => { outputEl.select(); document.execCommand('copy'); showToast('▲ Copied'); });
});

// ── Download ──────────────────────────────────────────────────
btnDl.addEventListener('click', () => {
  if (!outputEl.value) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([outputEl.value], {type:'text/plain'}));
  a.download = 'obfuscated.lua';
  a.click();
  showToast('Downloaded');
});

// ── Clear ─────────────────────────────────────────────────────
btnClear.addEventListener('click', () => {
  inputEl.value = outputEl.value = '';
  lnIn.textContent = lnOut.textContent = '';
  document.getElementById('stat-in').textContent  = '0 lines · 0 chars';
  document.getElementById('stat-out').textContent = '0 lines · 0 chars';
  statsCard.classList.remove('visible');
});

// ── Sample ────────────────────────────────────────────────────
btnSample.addEventListener('click', () => {
  inputEl.value = SAMPLE;
  updateLN(inputEl, lnIn);
  updateInStat();
  showToast('Sample loaded');
});

// ── Tab key ───────────────────────────────────────────────────
inputEl.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const s = inputEl.selectionStart, v = inputEl.value;
  inputEl.value = v.slice(0,s) + '  ' + v.slice(inputEl.selectionEnd);
  inputEl.selectionStart = inputEl.selectionEnd = s + 2;
  updateLN(inputEl, lnIn);
});

// ── Toast ─────────────────────────────────────────────────────
let toastT;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toast.classList.remove('show'), 2200);
}

function fmt(n) { return n < 1024 ? n + ' B' : (n/1024).toFixed(1) + ' KB'; }

// ── Init with Level 2 ─────────────────────────────────────────
applyLevel(2);
updateLN(inputEl, lnIn);
updateInStat();
