// ════════════════════════════════════════════════════════════
//  LuaShield — UI / App Logic
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

// ── Sample script (TSB-style Roblox script)
const SAMPLE = `-- TSB Combat Utility — Auto Dash & Combo Tracker
local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")

local LocalPlayer = Players.LocalPlayer
local Character = LocalPlayer.Character or LocalPlayer.CharacterAdded:Wait()
local HRP = Character:WaitForChild("HumanoidRootPart")
local Humanoid = Character:WaitForChild("Humanoid")

-- Configuration
local dashDelay = 0.15
local comboCooldown = 0.4
local maxCombo = 5
local attackMultiplier = 1.75
local playerTag = "TSBPlayer"

-- State
local comboCount = 0
local lastDash = 0
local isAttacking = false
local targetEnemy = nil

local function getEnemies(range)
    local enemies = {}
    local myPos = HRP.Position
    for _, player in ipairs(Players:GetPlayers()) do
        if player ~= LocalPlayer and player.Character then
            local enemyHRP = player.Character:FindFirstChild("HumanoidRootPart")
            if enemyHRP then
                local dist = (myPos - enemyHRP.Position).Magnitude
                if dist <= range then
                    table.insert(enemies, {player = player, dist = dist})
                end
            end
        end
    end
    table.sort(enemies, function(a, b) return a.dist < b.dist end)
    return enemies
end

local function fireDash(direction)
    local remote = game:GetService("ReplicatedStorage").Resources
    remote.Brother["#Friend"].Communicate:FireServer({
        Dash = direction,
        Combo = comboCount
    })
end

local function onHeartbeat(dt)
    local now = tick()
    if now - lastDash < dashDelay then return end
    local nearby = getEnemies(25)
    if #nearby > 0 then
        targetEnemy = nearby[1].player
    end
end

RunService.Heartbeat:Connect(onHeartbeat)
print("Combat utility loaded for: " .. LocalPlayer.Name)
print("Tag: " .. playerTag .. " | Multiplier: " .. tostring(attackMultiplier))
`;

// ── Line numbers
function updateLineNumbers(textarea, container) {
  const lines = textarea.value.split('\n').length;
  const nums = [];
  for (let i = 1; i <= lines; i++) nums.push(i);
  container.textContent = nums.join('\n');
}

function syncScroll(textarea, lnContainer) {
  lnContainer.scrollTop = textarea.scrollTop;
}

inputEl.addEventListener('input',  () => { updateLineNumbers(inputEl, lnIn);    updateInputStat(); });
inputEl.addEventListener('scroll', () => syncScroll(inputEl, lnIn));
outputEl.addEventListener('scroll',() => syncScroll(outputEl, lnOut));

function updateInputStat() {
  const lines = inputEl.value.split('\n').length;
  document.getElementById('stat-in').textContent = `${lines} lines · ${inputEl.value.length} chars`;
}

function updateOutputStat() {
  const lines = outputEl.value.split('\n').length;
  document.getElementById('stat-out').textContent = `${lines} lines · ${outputEl.value.length} chars`;
}

// ── Level presets
const LEVELS = {
  1: { comments:true, minify:true, rename:false, strings:false, numbers:false, junk:false, closure:false, constTable:false },
  2: { comments:true, minify:true, rename:true,  strings:true,  numbers:true,  junk:false, closure:false, constTable:false },
  3: { comments:true, minify:true, rename:true,  strings:true,  numbers:true,  junk:true,  closure:true,  constTable:true  }
};

document.querySelectorAll('.lvl-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.lvl-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const p = LEVELS[+btn.dataset.level];
    document.getElementById('opt-comments').checked   = p.comments;
    document.getElementById('opt-minify').checked     = p.minify;
    document.getElementById('opt-rename').checked     = p.rename;
    document.getElementById('opt-strings').checked    = p.strings;
    document.getElementById('opt-numbers').checked    = p.numbers;
    document.getElementById('opt-junk').checked       = p.junk;
    document.getElementById('opt-closure').checked    = p.closure;
    document.getElementById('opt-consttable').checked = p.constTable;
  });
});

// ── Obfuscate
btnObf.addEventListener('click', () => {
  const src = inputEl.value.trim();
  if (!src) { showToast('Paste some Lua code first!'); return; }

  btnObf.disabled = true;
  btnObfTxt.innerHTML = '<span class="loading">Obfuscating…</span>';

  // Defer to allow paint
  setTimeout(() => {
    try {
      const opts = {
        removeComments  : document.getElementById('opt-comments').checked,
        minify          : document.getElementById('opt-minify').checked,
        renameVars      : document.getElementById('opt-rename').checked,
        encryptStrings  : document.getElementById('opt-strings').checked,
        obfuscateNumbers: document.getElementById('opt-numbers').checked,
        addJunk         : document.getElementById('opt-junk').checked,
        wrapClosure     : document.getElementById('opt-closure').checked,
        constTable      : document.getElementById('opt-consttable').checked,
        watermark       : document.getElementById('opt-watermark').checked
      };

      const result = window.LuaObfuscator.obfuscate(src, opts);

      outputEl.value = result.code;
      updateLineNumbers(outputEl, lnOut);
      updateOutputStat();

      // Stats
      const ratio = src.length > 0
        ? ((result.code.length / src.length) * 100).toFixed(0)
        : '—';

      document.getElementById('stat-before').textContent  = fmtBytes(src.length);
      document.getElementById('stat-after').textContent   = fmtBytes(result.code.length);
      document.getElementById('stat-ratio').textContent   = ratio + '%';
      document.getElementById('stat-vars').textContent    = result.varsRenamed;
      document.getElementById('stat-strings').textContent = result.stringsEncrypted;

      statsCard.classList.add('visible');
      showToast('✓ Obfuscated successfully');

    } catch (err) {
      outputEl.value = `-- [LuaShield Error]\n-- ${err.message}\n-- Check browser console for details.`;
      updateLineNumbers(outputEl, lnOut);
      console.error('[LuaShield]', err);
      showToast('Error — see output panel');
    }

    btnObf.disabled = false;
    btnObfTxt.textContent = 'Obfuscate';
  }, 30);
});

// ── Copy
btnCopy.addEventListener('click', () => {
  if (!outputEl.value) return;
  navigator.clipboard.writeText(outputEl.value)
    .then(() => showToast('▲ Copied to clipboard'))
    .catch(() => {
      outputEl.select();
      document.execCommand('copy');
      showToast('▲ Copied');
    });
});

// ── Download
btnDl.addEventListener('click', () => {
  if (!outputEl.value) return;
  const blob = new Blob([outputEl.value], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'obfuscated.lua' });
  a.click();
  URL.revokeObjectURL(url);
  showToast('Downloaded obfuscated.lua');
});

// ── Clear
btnClear.addEventListener('click', () => {
  inputEl.value  = '';
  outputEl.value = '';
  lnIn.textContent  = '';
  lnOut.textContent = '';
  document.getElementById('stat-in').textContent  = '0 lines · 0 chars';
  document.getElementById('stat-out').textContent = '0 lines · 0 chars';
  statsCard.classList.remove('visible');
});

// ── Sample
btnSample.addEventListener('click', () => {
  inputEl.value = SAMPLE;
  updateLineNumbers(inputEl, lnIn);
  updateInputStat();
  showToast('Sample script loaded');
});

// ── Tab key support in textarea
inputEl.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const s = inputEl.selectionStart;
  const v = inputEl.value;
  inputEl.value = v.slice(0, s) + '  ' + v.slice(inputEl.selectionEnd);
  inputEl.selectionStart = inputEl.selectionEnd = s + 2;
  updateLineNumbers(inputEl, lnIn);
});

// ── Toast
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Helpers
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  return (n / 1024).toFixed(1) + ' KB';
}

// ── Init
updateLineNumbers(inputEl, lnIn);
updateInputStat();
