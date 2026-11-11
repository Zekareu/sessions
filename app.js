/**
 * Sessions web app
 * Authentic Game Flow: Hub -> Game Setup Page -> Press Play -> Play (Start Only When Down)
 */

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const savedOutputMode = localStorage.getItem("os_output_mode");
const savedBpmCueMode = localStorage.getItem("os_bpm_cue_mode");
const savedActionType = localStorage.getItem("os_action_type");
const config = {
  token: localStorage.getItem("os_token") || "",
  shockerId: localStorage.getItem("os_shocker_id") || "",
  outputMode: ["openshock", "pishock", "webhook"].includes(savedOutputMode) ? savedOutputMode : "openshock",
  webhookUrl: localStorage.getItem("os_webhook_url") || "",
  webhookToken: localStorage.getItem("os_webhook_token") || "",
  rewardWebhookUrl: localStorage.getItem("os_reward_webhook_url") || "",
  rewardWebhookToken: localStorage.getItem("os_reward_webhook_token") || "",
  piUsername: localStorage.getItem("os_pishock_username") || "",
  piApiKey: localStorage.getItem("os_pishock_key") || "",
  piShareCode: localStorage.getItem("os_pishock_code") || "",
  intensity: Math.max(1, Math.min(99, parseInt(localStorage.getItem("os_intensity") || "20", 10) || 20)),
  duration: Math.max(100, Math.min(10000, parseInt(localStorage.getItem("os_duration") || "1000", 10) || 1000)),
  actionType: ["Shock", "Vibrate", "Sound"].includes(savedActionType) ? savedActionType : "Shock",
  inputSource: localStorage.getItem("os_input_source") || "touch",
  camThreshold: parseInt(localStorage.getItem("os_cam_threshold") || "14", 10) || 14,
  luxThreshold: parseInt(localStorage.getItem("os_lux_threshold") || "15", 10) || 15,
  mpMode: localStorage.getItem("os_mp_mode") || "side",
  mpSideDir: localStorage.getItem("os_mp_side_dir") || "ltr",
  mpTopDir: localStorage.getItem("os_mp_top_dir") || "ttb",
  mpTripwireX: parseFloat(localStorage.getItem("os_mp_tripwire_x") || "0.65"),
  mpTripwireY: parseFloat(localStorage.getItem("os_mp_tripwire_y") || "0.70"),
  mpRetractX: parseFloat(localStorage.getItem("os_mp_retract_x") || "0.35"),
  mpRetractY: parseFloat(localStorage.getItem("os_mp_retract_y") || "0.40"),
  mpHiltThreshold: parseFloat(localStorage.getItem("os_mp_hilt_threshold") || "5.0"),
  mpRetractDist: parseFloat(localStorage.getItem("os_mp_retract_dist") || "14.0"),
  mpMouthLock: localStorage.getItem("os_mp_mouth_lock") === "off" ? "off" : "on",
  mpMouthSens: Math.max(10, Math.min(65, parseInt(localStorage.getItem("os_mp_mouth_sens") || "24", 10) || 24)),
  bpmCueMode: ["down", "down_up", "off"].includes(savedBpmCueMode) ? savedBpmCueMode : "down",
  wsUrl: localStorage.getItem("os_ws_url") || "ws://localhost:8080"
};

let isPhysicalDown = false;
let isRepStrokeArmed = true;
let lastShockSentTime = 0;
let punishLoopInterval = null;
let currentScreen = "hub";

// Web Audio API Synthesizer
let audioCtx = null;
function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function playTone(freq, durationMs, type = "sine") {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (durationMs / 1000));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (durationMs / 1000));
  } catch (e) {}
}

// ==========================================
// 1B. BPM STROKE PACER ("DOWN" & OPTIONAL "UP" AUDIO CUES)
// ==========================================
let bpmPacerTicker = null;
let bpmUpCueTimeout = null;
let bpmPulseResetTimeout = null;
let bpmPacerBeatCount = 0;

/**
 * Authoritative deep downward pitch-drop ("DOWN!") cue so the subject
 * clearly distinguishes the target down-stroke beat from hit chimes.
 */
function playBpmDownCue() {
  try {
    const ctx = getAudio();
    const t0 = ctx.currentTime;

    // Deep downward body thump (340Hz -> 125Hz)
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(340, t0);
    osc.frequency.exponentialRampToValueAtTime(125, t0 + 0.14);
    gain.gain.setValueAtTime(0.28, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.15);

    // Crisp transient attack so small phone/laptop speakers project the beat clearly
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = "sine";
    clickOsc.frequency.setValueAtTime(620, t0);
    clickOsc.frequency.exponentialRampToValueAtTime(220, t0 + 0.045);
    clickGain.gain.setValueAtTime(0.15, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickOsc.start(t0);
    clickOsc.stop(t0 + 0.05);
  } catch (e) {}
}

/**
 * Lighter upward pitch cue ("UP / RETRACT") at the 50% midpoint of the beat.
 */
function playBpmUpCue() {
  try {
    const ctx = getAudio();
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, t0);
    osc.frequency.exponentialRampToValueAtTime(640, t0 + 0.07);
    gain.gain.setValueAtTime(0.12, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.075);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.075);
  } catch (e) {}
}

function refreshBpmCuePillIdle(cueElementId) {
  const el = cueElementId ? document.getElementById(cueElementId) : null;
  if (!el) return;
  el.classList.remove("pulse-down", "pulse-up");
  if (config.bpmCueMode === "off") {
    el.textContent = "🔇 PACER MUTED";
  } else if (config.bpmCueMode === "down_up") {
    el.textContent = "⬇ DOWN • ⬆ UP PACER";
  } else {
    el.textContent = "⬇ LISTEN FOR DOWN BEAT";
  }
}

function pulseBpmCueUI(cueElementId, arenaId, direction) {
  const cueEl = cueElementId ? document.getElementById(cueElementId) : null;
  const arenaEl = arenaId ? document.getElementById(arenaId) : null;
  if (bpmPulseResetTimeout) clearTimeout(bpmPulseResetTimeout);

  if (cueEl) {
    cueEl.classList.remove("pulse-down", "pulse-up");
    if (direction === "down") {
      cueEl.textContent = "⬇ DOWN NOW!";
      cueEl.classList.add("pulse-down");
    } else {
      cueEl.textContent = "⬆ RETRACT UP";
      cueEl.classList.add("pulse-up");
    }
  }
  if (arenaEl && direction === "down") {
    arenaEl.classList.add("arena-beat-pulse");
  }

  bpmPulseResetTimeout = setTimeout(() => {
    if (cueEl) cueEl.classList.remove("pulse-down", "pulse-up");
    if (arenaEl) arenaEl.classList.remove("arena-beat-pulse");
  }, 160);
}

function stopBpmPacer() {
  if (bpmPacerTicker) {
    clearInterval(bpmPacerTicker);
    bpmPacerTicker = null;
  }
  if (bpmUpCueTimeout) {
    clearTimeout(bpmUpCueTimeout);
    bpmUpCueTimeout = null;
  }
  if (bpmPulseResetTimeout) {
    clearTimeout(bpmPulseResetTimeout);
    bpmPulseResetTimeout = null;
  }
  ["bpm-arena", "te-arena", "dts-arena", "prison-arena"].forEach(id => {
    const a = document.getElementById(id);
    if (a) a.classList.remove("arena-beat-pulse");
  });
}

function startBpmPacer(bpm, cueElementId, arenaId, playImmediately = false) {
  stopBpmPacer();
  refreshBpmCuePillIdle(cueElementId);
  if (!bpm || bpm <= 0) return;

  const intervalMs = Math.max(250, Math.round((60 / bpm) * 1000));

  const scheduleHalfBeatUp = () => {
    if (config.bpmCueMode === "down_up") {
      if (bpmUpCueTimeout) clearTimeout(bpmUpCueTimeout);
      bpmUpCueTimeout = setTimeout(() => {
        if (config.bpmCueMode === "down_up") {
          playBpmUpCue();
          pulseBpmCueUI(cueElementId, arenaId, "up");
        }
      }, Math.round(intervalMs * 0.5));
    }
  };

  const fireDownBeat = () => {
    bpmPacerBeatCount++;
    if (config.bpmCueMode === "off") {
      refreshBpmCuePillIdle(cueElementId);
      return;
    }
    playBpmDownCue();
    pulseBpmCueUI(cueElementId, arenaId, "down");
    scheduleHalfBeatUp();
  };

  if (playImmediately) {
    fireDownBeat();
  } else if (config.bpmCueMode === "down_up") {
    // Anchor half-beat UP cue right after the user's stroke!
    scheduleHalfBeatUp();
  }

  bpmPacerTicker = setInterval(fireDownBeat, intervalMs);
}

function initBpmCueSelectors() {
  const syncPills = (mode) => {
    config.bpmCueMode = mode;
    localStorage.setItem("os_bpm_cue_mode", mode);
    document.querySelectorAll(".pill-select[data-bpm-cue]").forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-bpm-cue") === mode);
    });
    ["bpm-pacer-cue", "te-pacer-cue", "dts-pacer-cue", "prison-pacer-cue"].forEach(refreshBpmCuePillIdle);
  };

  syncPills(config.bpmCueMode);
  document.querySelectorAll(".pill-select[data-bpm-cue]").forEach(btn => {
    btn.addEventListener("click", () => {
      const chosen = btn.getAttribute("data-bpm-cue");
      syncPills(chosen);
      if (chosen === "down") playBpmDownCue();
      else if (chosen === "down_up") {
        playBpmDownCue();
        setTimeout(() => playBpmUpCue(), 320);
      }
    });
  });
}

// ==========================================
// 2. PUNISHMENT OUTPUT DISPATCHER
// ==========================================
async function sendPunishment(actionOverride = null, intensityOverride = null, outputOverride = null) {
  const now = Date.now();
  if (!outputOverride && now - lastShockSentTime < 1200) {
    return { success: false, message: "Cooldown active" };
  }
  lastShockSentTime = now;

  const settings = outputOverride || config;
  const rawAction = actionOverride || settings.actionType || config.actionType;
  const apiAction = rawAction === "Beep" ? "Sound" : rawAction;
  const chosenIntensity = intensityOverride !== null ? intensityOverride : (settings.intensity ?? config.intensity);
  const apiIntensity = apiAction === "Sound" ? 0 : Math.max(1, Math.min(99, chosenIntensity));
  const apiDuration = Math.max(100, Math.min(10000, settings.duration ?? config.duration));
  const mode = settings.outputMode || "openshock";

  // Hardware modes show the selected action; a webhook is a generic event.
  if (mode !== "webhook") {
    const flash = document.getElementById("punishment-flash");
    if (flash) {
      document.getElementById("punish-text").textContent = `${rawAction.toUpperCase()} FEEDBACK (${apiIntensity}%)`;
      flash.classList.remove("hidden");
      setTimeout(() => flash.classList.add("hidden"), 700);
    }
    playTone(180, 450, "sawtooth");
  }

  const requests = [];

  if (mode === "openshock") {
    requests.push((async () => {
      const token = (settings.token || "").trim();
      const shockerId = (settings.shockerId || "").trim();
      if (!token || !shockerId) return { success: false, message: "OpenShock token or shocker UUID missing" };
      try {
        const res = await fetch("https://api.openshock.app/2/shockers/control", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Open-Shock-Token": token },
          body: JSON.stringify({ shocks: [{
            id: shockerId, type: apiAction, intensity: apiIntensity,
            duration: apiDuration, exclusive: false
          }] })
        });
        return { success: res.ok, code: res.status, message: res.ok ? "" : `OpenShock HTTP ${res.status}` };
      } catch (err) {
        return { success: false, message: `OpenShock: ${err.message}` };
      }
    })());
  }

  if (mode === "pishock") {
    requests.push((async () => {
      const username = (settings.piUsername || "").trim();
      const key = (settings.piApiKey || "").trim();
      const code = (settings.piShareCode || "").trim();
      if (!username || !key || !code) {
        return { success: false, message: "PiShock username, API key, or share code missing" };
      }
      const operation = { Shock: "0", Vibrate: "1", Sound: "2" }[apiAction];
      try {
        const payload = {
          Username: username, Apikey: key, Code: code, Name: "Sessions",
          Op: operation, Duration: String(Math.max(1, Math.ceil(apiDuration / 1000)))
        };
        if (apiAction !== "Sound") payload.Intensity = String(apiIntensity);
        const res = await fetch("https://do.pishock.com/api/apioperate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const message = (await res.text()).trim();
        const success = res.ok && message === "Operation Succeeded.";
        return { success, code: res.status, message: success ? "" : `PiShock: ${message || `HTTP ${res.status}`}` };
      } catch (err) {
        return { success: false, message: `PiShock: ${err.message}` };
      }
    })());
  }

  if (mode === "webhook") {
    requests.push((async () => {
      const webhookUrl = (settings.webhookUrl || "").trim();
      let url;
      try {
        url = new URL(webhookUrl);
        if (!(["https:", "http:"].includes(url.protocol))) throw new Error("Use an HTTP or HTTPS URL");
      } catch (err) {
        return { success: false, message: "Enter a valid webhook URL" };
      }
      try {
        const headers = { "Content-Type": "application/json" };
        if (settings.webhookToken) headers.Authorization = `Bearer ${settings.webhookToken}`;
        const res = await fetch(url.href, {
          method: "POST",
          headers,
          body: JSON.stringify({
            event: "punishment", game: currentScreen, timestamp: new Date().toISOString()
          })
        });
        return { success: res.ok, code: res.status, message: res.ok ? "" : `Webhook HTTP ${res.status}` };
      } catch (err) {
        return { success: false, message: `Webhook: ${err.message}` };
      }
    })());
  }

  if (!requests.length) return { success: false, message: "Select a punishment output" };
  const results = await Promise.all(requests);
  return {
    success: results.every(result => result.success),
    code: results.map(result => result.code).filter(Boolean).join(", "),
    message: results.filter(result => !result.success).map(result => result.message).join("; ")
  };
}

let rewardSentForSession = false;

async function sendRewardWebhook(game, override = null, isTest = false) {
  const urlText = (override?.rewardWebhookUrl ?? config.rewardWebhookUrl).trim();
  const token = (override?.rewardWebhookToken ?? config.rewardWebhookToken).trim();
  if (!urlText) return { success: false, message: "Enter a reward webhook URL" };
  let url;
  try {
    url = new URL(urlText);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid URL");
  } catch (_) {
    return { success: false, message: "Enter a valid HTTP or HTTPS reward webhook URL" };
  }
  try {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(url.href, {
      method: "POST",
      headers,
      body: JSON.stringify({
        event: "reward",
        result: "completed",
        game: isTest ? "test" : `game-${game}`,
        test: isTest,
        timestamp: new Date().toISOString()
      })
    });
    return {
      success: response.ok,
      code: response.status,
      message: response.ok ? "" : `Reward webhook HTTP ${response.status}`
    };
  } catch (error) {
    return { success: false, message: `Reward webhook: ${error.message}` };
  }
}

function sendRewardOnce(game) {
  if (rewardSentForSession || !config.rewardWebhookUrl) return;
  rewardSentForSession = true;
  sendRewardWebhook(game).then(result => {
    if (!result.success) console.warn(result.message);
  });
}

let currentPunishIntensityOverride = null;

function startPunishLoop(intensityOverride = null, intervalMs = 1600) {
  currentPunishIntensityOverride = intensityOverride;
  if (punishLoopInterval) return;
  sendPunishment(null, currentPunishIntensityOverride);
  punishLoopInterval = setInterval(() => {
    sendPunishment(null, currentPunishIntensityOverride);
  }, intervalMs);
}

function stopPunishLoop() {
  if (punishLoopInterval) {
    clearInterval(punishLoopInterval);
    punishLoopInterval = null;
  }
  currentPunishIntensityOverride = null;
}

// ==========================================
// 3. NAVIGATION & SCREEN SWITCHING
// ==========================================
const SHAREABLE_GAMES = new Set([
  "holdchallenge", "holddearlife", "reachcount", "rhythm",
  "tower", "routine", "blindhilt", "tempoescalation"
]);

// Only controls inside a game setup screen are shared. Device connections,
// credentials, input sources, and other account settings never enter the URL.
function getSessionControls(screen) {
  const groups = new Map();
  screen.querySelectorAll(".pill-select").forEach(button => {
    const option = Array.from(button.attributes).find(attr => attr.name.startsWith("data-"));
    if (!option) return;
    if (!groups.has(option.name)) groups.set(option.name, []);
    groups.get(option.name).push(button);
  });
  const ranges = Array.from(screen.querySelectorAll('input[type="range"]'));
  return { groups, ranges };
}

function createSessionLink(game) {
  const screen = document.getElementById(`screen-setup-${game}`);
  if (!screen || !SHAREABLE_GAMES.has(game)) return null;
  const { groups, ranges } = getSessionControls(screen);
  const choices = [];
  for (const [key, buttons] of groups) {
    const selected = buttons.find(button => button.classList.contains("active"));
    if (!selected) return null;
    choices.push([key, selected.getAttribute(key)]);
  }
  const payload = {
    v: 1,
    game,
    choices,
    ranges: ranges.map(input => [input.id, input.value])
  };
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = `session=${encodeURIComponent(JSON.stringify(payload))}`;
  return url.toString();
}

function applySessionLink(payload) {
  if (!payload || payload.v !== 1 || !SHAREABLE_GAMES.has(payload.game) ||
      !Array.isArray(payload.choices) || !Array.isArray(payload.ranges)) return false;
  const screen = document.getElementById(`screen-setup-${payload.game}`);
  if (!screen) return false;
  const { groups, ranges } = getSessionControls(screen);
  if (payload.choices.length !== groups.size || payload.ranges.length !== ranges.length) return false;

  // Validate every choice against the actual buttons before changing any state.
  const selectedButtons = [];
  for (const [key, buttons] of groups) {
    const entries = payload.choices.filter(pair =>
      Array.isArray(pair) && pair.length === 2 && pair[0] === key);
    if (entries.length !== 1 || typeof entries[0][1] !== "string") return false;
    const button = buttons.find(candidate => candidate.getAttribute(key) === entries[0][1]);
    if (!button) return false;
    selectedButtons.push(button);
  }
  const selectedRanges = [];
  for (const input of ranges) {
    const entries = payload.ranges.filter(pair =>
      Array.isArray(pair) && pair.length === 2 && pair[0] === input.id);
    if (entries.length !== 1 || typeof entries[0][1] !== "string") return false;
    const value = Number(entries[0][1]);
    const min = Number(input.min);
    const max = Number(input.max);
    const step = input.step === "any" ? 0 : Number(input.step || "1");
    if (!Number.isFinite(value) || value < min || value > max ||
        (step && Math.abs((value - min) / step - Math.round((value - min) / step)) > 0.00001)) return false;
    selectedRanges.push([input, entries[0][1]]);
  }

  selectedButtons.forEach(button => button.click());
  selectedRanges.forEach(([input, value]) => {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  switchScreen(`setup-${payload.game}`);
  return true;
}

function initSessionSharing() {
  SHAREABLE_GAMES.forEach(game => {
    const screen = document.getElementById(`screen-setup-${game}`);
    const playButton = document.getElementById(`btn-play-${game}`);
    if (!screen || !playButton) return;
    const controls = document.createElement("div");
    controls.className = "share-controls";
    controls.innerHTML = `<button type="button" class="share-button">Copy share link</button>
      <input class="share-link hidden" type="text" readonly aria-label="Share link">
      <p class="share-note">Use a published site to share with others. The link includes this game setup only. Device connections and account details stay on your device.</p>
      <p class="share-feedback" role="status" aria-live="polite"></p>`;
    playButton.insertAdjacentElement("afterend", controls);
    const button = controls.querySelector(".share-button");
    const input = controls.querySelector(".share-link");
    const feedback = controls.querySelector(".share-feedback");
    button.addEventListener("click", async () => {
      const link = createSessionLink(game);
      if (!link) {
        feedback.textContent = "Select an option for each setting before sharing.";
        return;
      }
      input.value = link;
      input.classList.remove("hidden");
      input.select();
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(link);
        feedback.textContent = "Link copied. The recipient can review the settings before starting.";
      } catch (_) {
        feedback.textContent = "Copy the link above. Share a published site URL with other people.";
      }
    });
    input.addEventListener("click", () => input.select());
  });

  if (!window.location.hash.startsWith("#session=")) return;
  let payload;
  try {
    const raw = window.location.hash.slice("#session=".length);
    if (raw.length > 6000) throw new Error("Link too long");
    payload = JSON.parse(decodeURIComponent(raw));
  } catch (_) {}
  if (applySessionLink(payload)) {
    const feedback = document.querySelector(`#screen-setup-${payload.game} .share-feedback`);
    if (feedback) feedback.textContent = "Shared settings loaded. Review them before starting.";
  } else {
    const notice = document.createElement("p");
    notice.className = "share-notice";
    notice.textContent = "This share link is invalid or uses settings this version does not support.";
    document.querySelector(".hub-hero").insertAdjacentElement("afterend", notice);
  }
}

function switchScreen(targetScreen) {
  currentScreen = targetScreen;
  if (targetScreen.startsWith("game-")) rewardSentForSession = false;
  if (document.activeElement && typeof document.activeElement.blur === "function") {
    document.activeElement.blur();
  }
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(`screen-${targetScreen}`);
  if (target) target.classList.add("active");

  const backBtn = document.getElementById("btn-nav-back");
  const title = document.getElementById("app-title");

  stopAllGames();

  if (targetScreen === "hub") {
    backBtn.classList.add("hidden");
    title.textContent = "SESSIONS";
  } else {
    backBtn.classList.remove("hidden");
    if (targetScreen.startsWith("setup-")) {
      const g = targetScreen.replace("setup-", "");
      if (g === "holdchallenge") title.textContent = "SETUP: HOLD DEBT";
      else if (g === "holddearlife") title.textContent = "SETUP: LASTING HOLD";
      else if (g === "reachcount") title.textContent = "SETUP: COUNT CLIMB";
      else if (g === "rhythm") title.textContent = "SETUP: PULSE RUNNER";
      else if (g === "tower") title.textContent = "SETUP: HOLD SUMMIT";
      else if (g === "routine") title.textContent = "SETUP: CIRCUIT QUEST";
      else if (g === "blindhilt") title.textContent = "SETUP: HIDDEN TIMER";
      else if (g === "tempoescalation") title.textContent = "SETUP: TEMPO ASCENT";
    } else if (targetScreen.startsWith("game-")) {
      const g = targetScreen.replace("game-", "");
      if (g === "holdchallenge") {
        title.textContent = "HOLD DEBT";
        resetHoldChallengeState();
      } else if (g === "holddearlife") {
        title.textContent = "LASTING HOLD";
        resetHoldDearLifeState();
      } else if (g === "reachcount") {
        title.textContent = "COUNT CLIMB";
        resetReachCountState();
      } else if (g === "rhythm") {
        title.textContent = "PULSE RUNNER";
        resetBpmGame();
      } else if (g === "tower") {
        title.textContent = "HOLD SUMMIT";
        resetTowerState();
      } else if (g === "routine") {
        title.textContent = "CIRCUIT QUEST";
        resetDtsGame();
      } else if (g === "blindhilt") {
        title.textContent = "HIDDEN TIMER";
        resetBlindHiltState();
      } else if (g === "tempoescalation") {
        title.textContent = "TEMPO ASCENT";
        resetTempoEscalationState();
      } else if (g === "prison") {
        title.textContent = "DEEPTHROAT PRISON";
        resetPrisonGameArena();
      }
    }
  }
}

function handleBackNavigation() {
  if (currentScreen === "game-prison") {
    if (prisonPenaltyActive) {
      // Cannot escape during mandatory penalty hold!
      return;
    }
    if (prisonHasStartedStage && pendingPrisonAssignment) {
      if (pendingPrisonAssignment.cumulativeKey) {
        savePrisonState();
        switchScreen("hub");
        renderPrisonDashboard();
        return;
      }
      failPrisonTask("Abandoned active task mid-execution.");
      return;
    }
    switchScreen("hub");
    renderPrisonDashboard();
    return;
  }
  if (currentScreen.startsWith("game-")) {
    const g = currentScreen.replace("game-", "");
    switchScreen(`setup-${g}`);
  } else if (currentScreen.startsWith("setup-")) {
    switchScreen("hub");
  } else {
    switchScreen("hub");
  }
}

function stopAllGames() {
  isPhysicalDown = false;
  mpSessionHadMouthContact = false;
  mpMouthDropPunishing = false;
  stopBpmPacer();
  stopHoldChallengeGame();
  stopHoldDearLifeGame();
  stopReachCountGame();
  stopBpmGame();
  stopTowerGame();
  stopDtsGame();
  stopBlindHiltGame();
  stopTempoEscalationGame();
  if (typeof stopPrisonGame === "function") stopPrisonGame();
  stopPunishLoop();
  document.body.removeAttribute("data-game-state");
  updateStatusIndicator(false);
}

function setUnifiedGameState(stateName, labelText = null, subHintText = null) {
  const currentState = document.body.getAttribute("data-game-state");

  let arenaId = null;
  let labelId = null;
  let hintId = null;

  if (currentScreen === "game-holdchallenge") {
    arenaId = "hc-arena"; labelId = "hc-state-label"; hintId = "hc-sub-hint";
  } else if (currentScreen === "game-holddearlife") {
    arenaId = "hdl-arena"; labelId = "hdl-state-label"; hintId = "hdl-sub-hint";
  } else if (currentScreen === "game-reachcount") {
    arenaId = "dt-arena"; labelId = "dt-state-label"; hintId = "dt-sub-hint";
  } else if (currentScreen === "game-rhythm") {
    arenaId = "bpm-arena"; labelId = "bpm-state-label"; hintId = "bpm-sub-hint";
  } else if (currentScreen === "game-tower") {
    arenaId = "tower-arena"; labelId = "tower-state-label"; hintId = "tower-sub-hint";
  } else if (currentScreen === "game-routine") {
    arenaId = "dts-arena"; labelId = "dts-state-label"; hintId = "dts-sub-hint";
  } else if (currentScreen === "game-blindhilt") {
    arenaId = "bh-arena"; labelId = "bh-state-label"; hintId = "bh-sub-hint";
  } else if (currentScreen === "game-tempoescalation") {
    arenaId = "te-arena"; labelId = "te-state-label"; hintId = "te-sub-hint";
  } else if (currentScreen === "game-prison") {
    arenaId = "prison-arena"; labelId = "prison-state-label"; hintId = "prison-sub-hint";
  }

  const arena = arenaId ? document.getElementById(arenaId) : null;

  // Only remove/add state classes if state actually changed to preserve continuous CSS keyframe animations
  if (currentState !== stateName) {
    document.body.setAttribute("data-game-state", stateName);
    if (arena) {
      arena.classList.remove(
        "state-holding", "state-pause", "state-punish",
        "state-stalling", "state-must-hold", "state-can-release",
        "holding", "punishing"
      );

      arena.classList.add(`state-${stateName}`);
      if (stateName === "holding") arena.classList.add("holding");
      if (stateName === "punish") arena.classList.add("punishing");
    }

    // Update top sensor indicator pill
    const pill = document.getElementById("sensor-indicator");
    if (pill) {
      pill.className = `status-pill ${stateName}`;
      const titles = {
        holding: "HELD",
        pause: "PAUSE",
        punish: "SHOCK",
        stalling: "STALL",
        "must-hold": "HOLD!",
        "can-release": "RELEASE"
      };
      pill.textContent = titles[stateName] || stateName.toUpperCase();
    }
  }

  if (labelText && labelId) {
    const lbl = document.getElementById(labelId);
    if (lbl) lbl.textContent = labelText;
  }
  if (subHintText && hintId) {
    const hnt = document.getElementById(hintId);
    if (hnt) hnt.textContent = subHintText;
  }
}

function updateStatusIndicator(isDown) {
  if (!currentScreen.startsWith("game-")) {
    const pill = document.getElementById("sensor-indicator");
    if (pill) {
      if (isDown) {
        pill.className = "status-pill holding";
        pill.textContent = "HELD";
      } else {
        pill.className = "status-pill pause";
        pill.textContent = "IDLE";
      }
    }
  }
}

function handlePhysicalInputState(isDown) {
  if (isPhysicalDown === isDown) return;
  isPhysicalDown = isDown;
  updateStatusIndicator(isDown);

  if (currentScreen === "game-holdchallenge") {
    handleHoldChallengeLogic(isDown);
  } else if (currentScreen === "game-holddearlife") {
    handleHoldDearLifeLogic(isDown);
  } else if (currentScreen === "game-reachcount") {
    handleReachCountHoldLogic(isDown);
  } else if (currentScreen === "game-rhythm") {
    if (isDown) {
      if (isRepStrokeArmed) {
        handleBpmTap();
        isRepStrokeArmed = false;
      }
    } else {
      if (config.inputSource !== "mediapipe") {
        isRepStrokeArmed = true;
      }
    }
  } else if (currentScreen === "game-tower") {
    handleTowerLogic(isDown);
  } else if (currentScreen === "game-routine") {
    handleDtsHoldLogic(isDown);
  } else if (currentScreen === "game-blindhilt") {
    handleBlindHiltLogic(isDown);
  } else if (currentScreen === "game-tempoescalation") {
    handleTempoEscalationLogic(isDown);
  } else if (currentScreen === "game-prison") {
    handlePrisonSensorInput(isDown);
  }
}

// ==========================================
// 4. GAME 1: HOLD DEBT (DEBT + INITIAL HOLD + REST TIMER)
// ==========================================
let hcDebtTarget = 60;
let hcDebtRemaining = 60;
let hcGateSec = 5;
let hcGateRemaining = 5;
let hcPenaltySec = 5;
let hcRestSec = 6;
let hcRestRemaining = 6;
let hcIntensity = 20;

let hcPhase = "ready"; // "ready" | "gate" | "burning_debt" | "resting" | "rest_expired" | "gate_failed" | "won"
let hcTicker = null;
let hcRestTicker = null;

function initHoldChallengeGame() {
  // Debt Target pills
  document.querySelectorAll("#screen-setup-holdchallenge .pill-select[data-hc-debt]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-holdchallenge .pill-select[data-hc-debt]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hcDebtTarget = parseInt(btn.getAttribute("data-hc-debt"), 10);
    });
  });

  // Gate duration pills (Initial hold)
  document.querySelectorAll("#screen-setup-holdchallenge .pill-select[data-hc-gate]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-holdchallenge .pill-select[data-hc-gate]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hcGateSec = parseInt(btn.getAttribute("data-hc-gate"), 10);
    });
  });

  // Penalty pills
  document.querySelectorAll("#screen-setup-holdchallenge .pill-select[data-hc-penalty]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-holdchallenge .pill-select[data-hc-penalty]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hcPenaltySec = parseInt(btn.getAttribute("data-hc-penalty"), 10);
    });
  });

  // Max pause / rest watchdog pills
  document.querySelectorAll("#screen-setup-holdchallenge .pill-select[data-hc-rest]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-holdchallenge .pill-select[data-hc-rest]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hcRestSec = parseInt(btn.getAttribute("data-hc-rest"), 10);
    });
  });

  // Intensity slider
  const hcSlider = document.getElementById("setup-hc-intensity");
  hcSlider.addEventListener("input", (e) => {
    hcIntensity = parseInt(e.target.value, 10);
    document.getElementById("setup-hc-intensity-val").textContent = `${hcIntensity}%`;
  });

  document.getElementById("btn-play-holdchallenge").addEventListener("click", () => {
    switchScreen("game-holdchallenge");
  });

  const arena = document.getElementById("hc-arena");
  arena.addEventListener("pointerdown", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (config.inputSource === "touch") handlePhysicalInputState(true);
  });
}

function updateHoldChallengeUI() {
  const timer = document.getElementById("hc-big-timer");
  const gateBox = document.getElementById("hc-gate-box");
  const gateTimer = document.getElementById("hc-gate-timer");
  const gateLabel = document.getElementById("hc-gate-label");
  const phasePill = document.getElementById("hc-phase-pill");
  const intensityPill = document.getElementById("hc-intensity-pill");
  const progressBar = document.getElementById("hc-debt-progress");
  const restAlert = document.getElementById("hc-rest-alert");

  timer.textContent = hcDebtRemaining.toFixed(1);
  intensityPill.textContent = `DEVICE: ${hcIntensity}%`;

  const pct = Math.min(100, Math.max(0, (hcDebtRemaining / hcDebtTarget) * 100));
  progressBar.style.width = `${pct}%`;

  if (hcPhase === "ready") {
    phasePill.textContent = `INITIAL GATE: ${hcGateSec}s`;
    gateLabel.textContent = "INITIAL GATE:";
    gateTimer.textContent = `${hcGateSec.toFixed(1)}s`;
    gateBox.classList.remove("cleared", "burning");
    restAlert.classList.add("hidden");
    setUnifiedGameState("pause", "HOLD DOWN TO START GATE", `Hold for ${hcGateSec}s gate first to unlock debt burning.`);
  } else if (hcPhase === "gate") {
    phasePill.textContent = `GATE: ${Math.max(0, hcGateRemaining).toFixed(1)}s`;
    gateLabel.textContent = "INITIAL GATE:";
    gateTimer.textContent = `${Math.max(0, hcGateRemaining).toFixed(1)}s`;
    gateBox.classList.remove("cleared");
    gateBox.classList.add("burning");
    restAlert.classList.add("hidden");
    setUnifiedGameState("must-hold", "INITIAL HOLD GATE (DO NOT RELEASE!)", `Hold for ${Math.max(0, hcGateRemaining).toFixed(1)}s. Releasing early will shock!`);
  } else if (hcPhase === "burning_debt") {
    phasePill.textContent = "🔥 BURNING DEBT (CAN RELEASE)";
    gateLabel.textContent = "GATE:";
    gateTimer.textContent = "CLEARED! (BURNING DEBT)";
    gateBox.classList.add("cleared");
    gateBox.classList.remove("burning");
    restAlert.classList.add("hidden");
    setUnifiedGameState("can-release", "🔥 BURNING DEBT (CAN RELEASE TO REST)", "Gate passed! Keep holding to work down debt, or release safely to rest.");
  } else if (hcPhase === "resting") {
    phasePill.textContent = `REST: ${Math.ceil(hcRestRemaining)}s`;
    gateLabel.textContent = "NEXT GATE:";
    gateTimer.textContent = `${hcGateSec.toFixed(1)}s`;
    gateBox.classList.remove("cleared", "burning");
    restAlert.classList.remove("hidden");
    restAlert.innerHTML = `⚠️ REST TIMER: HOLD IN <span id="hc-rest-num">${Math.ceil(hcRestRemaining)}</span>s OR SHOCK!`;
    if (hcRestRemaining <= 2.5) {
      setUnifiedGameState("stalling");
    } else {
      setUnifiedGameState("pause");
    }
  } else if (hcPhase === "rest_expired") {
    phasePill.textContent = "⚠️ REST EXPIRED!";
    gateLabel.textContent = "NEXT GATE:";
    gateTimer.textContent = `${hcGateSec.toFixed(1)}s`;
    gateBox.classList.remove("cleared", "burning");
    restAlert.classList.remove("hidden");
    restAlert.innerHTML = "🚨 STALLING! CONTINUOUS SHOCK! HOLD NOW!";
    setUnifiedGameState("punish");
  } else if (hcPhase === "gate_failed") {
    phasePill.textContent = "⚠️ GATE FAILED";
    gateLabel.textContent = "NEXT GATE:";
    gateTimer.textContent = `${hcGateSec.toFixed(1)}s`;
    gateBox.classList.remove("cleared", "burning");
    restAlert.classList.add("hidden");
    setUnifiedGameState("punish");
  } else if (hcPhase === "won") {
    phasePill.textContent = "🏆 WON";
    gateLabel.textContent = "DEBT:";
    gateTimer.textContent = "0.0s (CLEARED!)";
    gateBox.classList.add("cleared");
    restAlert.classList.add("hidden");
    setUnifiedGameState("can-release", "🏆 CHALLENGE COMPLETE! DEBT PAID!", "Great work! You cleared all debt. You can release now.");
  }
}

function resetHoldChallengeState() {
  clearInterval(hcTicker);
  clearInterval(hcRestTicker);
  stopPunishLoop();

  hcDebtRemaining = hcDebtTarget;
  hcGateRemaining = hcGateSec;
  hcRestRemaining = hcRestSec;
  hcPhase = "ready";

  const arena = document.getElementById("hc-arena");
  arena.classList.remove("holding", "punishing");
  document.getElementById("hc-penalty-tag").classList.add("hidden");
  document.getElementById("hc-state-label").textContent = "HOLD DOWN TO START GATE";
  document.getElementById("hc-sub-hint").textContent = `Pass the ${hcGateSec}s initial hold gate to start burning down your ${hcDebtTarget}s debt. Stalling triggers shock!`;

  updateHoldChallengeUI();
}

function stopHoldChallengeGame() {
  clearInterval(hcTicker);
  clearInterval(hcRestTicker);
  stopPunishLoop();
}

function handleHoldChallengeLogic(isDown) {
  const arena = document.getElementById("hc-arena");
  const label = document.getElementById("hc-state-label");
  const subHint = document.getElementById("hc-sub-hint");
  const penaltyTag = document.getElementById("hc-penalty-tag");

  if (isDown) {
    // Subject is holding down
    clearInterval(hcRestTicker);
    stopPunishLoop();
    arena.classList.add("holding");
    arena.classList.remove("punishing");
    playTone(600, 80);

    if (hcPhase === "won") return;

    // Any hold attempt starts at the Initial Gate
    hcGateRemaining = hcGateSec;
    hcPhase = "gate";
    label.textContent = "INITIAL HOLD GATE IN PROGRESS...";
    subHint.textContent = `Hold for ${hcGateSec}s (doesn't count towards debt) to unlock debt burning!`;
    updateHoldChallengeUI();

    clearInterval(hcTicker);
    hcTicker = setInterval(() => {
      if (!isPhysicalDown) return;

      if (hcPhase === "gate") {
        hcGateRemaining = Math.max(0, hcGateRemaining - 0.1);
        updateHoldChallengeUI();

        if (hcGateRemaining <= 0) {
          // Gate cleared! Transition to burning debt!
          hcPhase = "burning_debt";
          playTone(587, 100);
          setTimeout(() => playTone(880, 150), 100);
          label.textContent = "🔥 GATE CLEARED! BURNING DOWN DEBT!";
          subHint.textContent = "Keep holding! Debt is now ticking down!";
          updateHoldChallengeUI();
        }
      } else if (hcPhase === "burning_debt") {
        hcDebtRemaining = Math.max(0, hcDebtRemaining - 0.1);
        updateHoldChallengeUI();

        if (hcDebtRemaining <= 0) {
          // VICTORY!
          clearInterval(hcTicker);
          hcPhase = "won";
          sendRewardOnce("holdchallenge");
          arena.classList.remove("holding");
          label.textContent = "🏆 CHALLENGE COMPLETE! DEBT PAID!";
          subHint.textContent = "Great work! You cleared all debt. You can release now.";
          updateHoldChallengeUI();

          playTone(523, 120);
          setTimeout(() => playTone(659, 120), 120);
          setTimeout(() => playTone(784, 300), 240);
        }
      }
    }, 100);

  } else {
    // Subject released
    arena.classList.remove("holding");
    clearInterval(hcTicker);

    if (hcPhase === "won") return;

    if (hcPhase === "gate") {
      // Released early during the initial hold gate!
      hcPhase = "gate_failed";
      arena.classList.add("punishing");

      if (hcPenaltySec > 0) {
        hcDebtRemaining += hcPenaltySec;
        penaltyTag.textContent = `+${hcPenaltySec}s PENALTY (GATE FAILED)`;
        penaltyTag.classList.remove("hidden");
        setTimeout(() => penaltyTag.classList.add("hidden"), 3000);
      }

      label.textContent = "⚠️ RELEASED EARLY! GATE FAILED!";
      subHint.textContent = `You released before clearing the ${hcGateSec}s gate! Penalty added! Continuous shock until held again!`;
      updateHoldChallengeUI();
      startPunishLoop(hcIntensity);

    } else if (hcPhase === "burning_debt") {
      // Released while burning debt. Permitted, but subject must not stall!
      hcPhase = "resting";
      hcRestRemaining = hcRestSec;
      label.textContent = `PAUSED / REST (${hcRestSec}s)`;
      subHint.textContent = `Next hold requires clearing the ${hcGateSec}s gate again before debt reduces. Don't stall!`;
      updateHoldChallengeUI();

      // Start anti-stall rest watchdog countdown
      clearInterval(hcRestTicker);
      hcRestTicker = setInterval(() => {
        if (isPhysicalDown) {
          clearInterval(hcRestTicker);
          return;
        }

        hcRestRemaining = Math.max(0, hcRestRemaining - 0.1);
        updateHoldChallengeUI();

        if (hcRestRemaining <= 0) {
          // Rest expired! Stalling detected! Continuous shock until held down!
          clearInterval(hcRestTicker);
          hcPhase = "rest_expired";
          arena.classList.add("punishing");
          label.textContent = "🚨 REST EXPIRED! REST TIMER WATCHDOG!";
          subHint.textContent = "STALLING DETECTED! Continuous shock until you hold down!";
          updateHoldChallengeUI();
          startPunishLoop(hcIntensity);
        }
      }, 100);

    } else if (hcPhase === "ready") {
      label.textContent = "HOLD DOWN TO START GATE";
      subHint.textContent = `Pass the ${hcGateSec}s initial hold gate to start burning down your ${hcDebtTarget}s debt. Stalling triggers shock!`;
      updateHoldChallengeUI();
    }
  }
}

// ==========================================
// 5. GAME 2: LASTING HOLD (RANDOM DURATION & CONTINUOUS SHOCK)
// ==========================================
let hdlDurationMode = "random"; // "random" | "unlimited"
let hdlMinSec = 30;
let hdlMaxSec = 90;
let hdlDisplayMode = "hidden"; // "hidden" | "visible"
let hdlTargetDuration = 60; // Rolled randomly between min & max

let hdlElapsedSeconds = 0;
let hdlTicker = null;
let hdlHasStarted = false;
let hdlHasWon = false;
let hdlIntensity = 20;

function initHoldDearLifeGame() {
  // Mode selection pills
  document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-mode]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hdlDurationMode = btn.getAttribute("data-hdl-mode");
      const randomSettings = document.getElementById("hdl-random-settings");
      if (randomSettings) {
        if (hdlDurationMode === "random") randomSettings.classList.remove("hidden");
        else randomSettings.classList.add("hidden");
      }
    });
  });

  // Min duration pills
  document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-min]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-min]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hdlMinSec = parseInt(btn.getAttribute("data-hdl-min"), 10);
      if (hdlMaxSec < hdlMinSec) {
        hdlMaxSec = hdlMinSec;
        document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-max]").forEach(b => {
          b.classList.toggle("active", parseInt(b.getAttribute("data-hdl-max"), 10) === hdlMaxSec);
        });
      }
    });
  });

  // Max duration pills
  document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-max]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-max]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hdlMaxSec = parseInt(btn.getAttribute("data-hdl-max"), 10);
      if (hdlMinSec > hdlMaxSec) {
        hdlMinSec = hdlMaxSec;
        document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-min]").forEach(b => {
          b.classList.toggle("active", parseInt(b.getAttribute("data-hdl-min"), 10) === hdlMinSec);
        });
      }
    });
  });

  // Display mode pills (Hidden vs Visible)
  document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-display]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-holddearlife .pill-select[data-hdl-display]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      hdlDisplayMode = btn.getAttribute("data-hdl-display");
    });
  });

  // Intensity slider
  const hdlSlider = document.getElementById("setup-hdl-intensity");
  hdlSlider.addEventListener("input", (e) => {
    hdlIntensity = parseInt(e.target.value, 10);
    document.getElementById("setup-hdl-intensity-val").textContent = `${hdlIntensity}%`;
  });

  document.getElementById("btn-play-holddearlife").addEventListener("click", () => {
    switchScreen("game-holddearlife");
  });

  const arena = document.getElementById("hdl-arena");
  arena.addEventListener("pointerdown", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (config.inputSource === "touch") handlePhysicalInputState(true);
  });
}

function formatHdlTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const ms = Math.floor((totalSec % 1) * 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`;
}

function rollHdlRandomTarget() {
  if (hdlDurationMode === "random") {
    const min = Math.min(hdlMinSec, hdlMaxSec);
    const max = Math.max(hdlMinSec, hdlMaxSec);
    hdlTargetDuration = Math.floor(Math.random() * (max - min + 1)) + min;
  } else {
    hdlTargetDuration = 1200; // 20m safety cap
  }
}

function updateHdlUI() {
  const timer = document.getElementById("hdl-big-timer");
  const modePill = document.getElementById("hdl-mode-pill");
  const intensityPill = document.getElementById("hdl-intensity-pill");
  const targetTag = document.getElementById("hdl-target-tag");
  const progressBar = document.getElementById("hdl-progress-bar");

  if (intensityPill) intensityPill.textContent = `DEVICE: ${hdlIntensity}%`;

  if (hdlDurationMode === "random") {
    if (hdlDisplayMode === "visible") {
      if (modePill) modePill.textContent = `TARGET: ${hdlTargetDuration}s`;
      if (targetTag) {
        targetTag.textContent = `TARGET: ${hdlTargetDuration}s`;
        targetTag.classList.remove("hidden");
      }
      const rem = Math.max(0, hdlTargetDuration - hdlElapsedSeconds);
      if (!hdlHasWon) timer.textContent = rem.toFixed(1) + "s";
      const pct = Math.min(100, (hdlElapsedSeconds / hdlTargetDuration) * 100);
      if (progressBar) progressBar.style.width = `${pct}%`;
    } else {
      // Hidden / Mystery
      if (modePill) modePill.textContent = `MYSTERY: ${hdlMinSec}s to ${hdlMaxSec}s`;
      if (targetTag) {
        targetTag.textContent = `MYSTERY TARGET [${hdlMinSec}s to ${hdlMaxSec}s]`;
        targetTag.classList.remove("hidden");
      }
      if (!hdlHasWon) timer.textContent = formatHdlTime(hdlElapsedSeconds);
      const minProgress = Math.min(100, (hdlElapsedSeconds / hdlMaxSec) * 100);
      if (progressBar) progressBar.style.width = `${minProgress}%`;
    }
  } else {
    // Unlimited endurance
    if (modePill) modePill.textContent = "ENDURANCE SURVIVAL";
    if (targetTag) targetTag.classList.add("hidden");
    if (!hdlHasWon) timer.textContent = formatHdlTime(hdlElapsedSeconds);
    if (progressBar) progressBar.style.width = "0%";
  }
}

function resetHoldDearLifeState() {
  clearInterval(hdlTicker);
  stopPunishLoop();
  hdlElapsedSeconds = 0;
  hdlHasStarted = false;
  hdlHasWon = false;

  rollHdlRandomTarget();

  setUnifiedGameState("must-hold", "HOLD DOWN TO START", hdlDurationMode === "random"
    ? `Hold for dear life until the target is cleared! Releasing shocks continuously!`
    : "Starts when held down. Releasing shocks continuously until pressed again!");

  updateHdlUI();
}

function stopHoldDearLifeGame() {
  clearInterval(hdlTicker);
  stopPunishLoop();
}

function handleHoldDearLifeLogic(isDown) {
  const label = document.getElementById("hdl-state-label");
  const subHint = document.getElementById("hdl-sub-hint");

  if (isDown) {
    stopPunishLoop(); // Shocks stop immediately on holding!
    playTone(600, 80);

    if (hdlHasWon) return;

    if (!hdlHasStarted) hdlHasStarted = true;
    setUnifiedGameState("holding", "HOLDING FOR DEAR LIFE...", hdlDurationMode === "random" && hdlDisplayMode === "hidden"
      ? `Mystery target active [${hdlMinSec}s to ${hdlMaxSec}s]! Keep holding!`
      : "Maintain contact! Releasing triggers continuous shock until held again!");

    clearInterval(hdlTicker);
    hdlTicker = setInterval(() => {
      if (!isPhysicalDown) return;

      hdlElapsedSeconds += 0.1;
      updateHdlUI();

      if (hdlElapsedSeconds >= hdlTargetDuration) {
        // VICTORY!
        clearInterval(hdlTicker);
        hdlHasWon = true;
        sendRewardOnce("holddearlife");
        stopPunishLoop();

        const timer = document.getElementById("hdl-big-timer");
        timer.textContent = `${hdlTargetDuration}.0s`;

        setUnifiedGameState("can-release", "🏆 YOU SURVIVED LASTING HOLD!", `Great work! You survived the random duration of ${hdlTargetDuration}s without breaking!`);

        playTone(523, 120);
        setTimeout(() => playTone(659, 120), 120);
        setTimeout(() => playTone(784, 150), 240);
        setTimeout(() => playTone(1046, 350), 380);
      }
    }, 100);

  } else {
    clearInterval(hdlTicker);

    if (hdlHasWon) return;

    // CRITICAL USER FIX: Does NOT stop on not holding! Continous shock on not holding!
    if (hdlHasStarted) {
      setUnifiedGameState("punish", "🚨 NOT HOLDING! CONTINUOUS SHOCK!", "PUT YOUR FINGER BACK DOWN TO STOP THE SHOCK AND RESUME!");
      startPunishLoop(hdlIntensity);
    }
  }
}

// ==========================================
// 6. GAME 3: COUNT CLIMB (ADVANCE NOTICE BEFORE HOLDS)
// ==========================================
let dtTargetCount = 50;
let dtCurrentReps = 0;
let dtSurpriseProb = 10;
let dtSurpriseHoldSec = 5;
let dtPenaltyReps = 5;
let dtIntensity = 20;

let dtWatchdogTimeoutSec = 5; // 0 = Off, or 3, 5, 8, 10s
let dtWatchdogWarnSec = 2; // Warning lead time (1, 2, 3s)

let dtIsPreHoldActive = false;
let dtIsSurpriseHoldActive = false;
let dtSurpriseHoldRemaining = 5.0;
let dtPreHoldTicker = null;
let dtSurpriseHoldTicker = null;
let dtWatchdogTicker = null;
let dtLastRepTimestamp = 0;

function initReachCountGame() {
  // Target reps
  document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-target]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dtTargetCount = parseInt(btn.getAttribute("data-dt-target"), 10);
    });
  });

  // Hold prob
  document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-prob]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-prob]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dtSurpriseProb = parseInt(btn.getAttribute("data-dt-prob"), 10);
    });
  });

  // Hold duration
  document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-holdduration]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-holdduration]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dtSurpriseHoldSec = parseInt(btn.getAttribute("data-dt-holdduration"), 10);
    });
  });

  // Penalty reps
  document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-penalty]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-penalty]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dtPenaltyReps = parseInt(btn.getAttribute("data-dt-penalty"), 10);
    });
  });

  // Stalling watchdog timeout pills
  document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-watchdog]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-watchdog]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dtWatchdogTimeoutSec = parseInt(btn.getAttribute("data-dt-watchdog"), 10);
      const warnCard = document.getElementById("dt-watchdog-warn-card");
      if (warnCard) {
        if (dtWatchdogTimeoutSec === 0) warnCard.classList.add("hidden");
        else warnCard.classList.remove("hidden");
      }
    });
  });

  // Stalling watchdog warning lead time pills
  document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-watchdog-warn]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-reachcount .pill-select[data-dt-watchdog-warn]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dtWatchdogWarnSec = parseInt(btn.getAttribute("data-dt-watchdog-warn"), 10);
    });
  });

  // Intensity slider
  const dtSlider = document.getElementById("setup-dt-intensity");
  dtSlider.addEventListener("input", (e) => {
    dtIntensity = parseInt(e.target.value, 10);
    document.getElementById("setup-dt-intensity-val").textContent = `${dtIntensity}%`;
  });

  document.getElementById("btn-play-reachcount").addEventListener("click", () => {
    switchScreen("game-reachcount");
  });

  const arena = document.getElementById("dt-arena");
  arena.addEventListener("pointerdown", handleReachCountTap);
}

function resetReachCountState() {
  stopReachCountGame();
  dtCurrentReps = 0;
  dtIsPreHoldActive = false;
  dtIsSurpriseHoldActive = false;
  dtLastRepTimestamp = 0;
  isRepStrokeArmed = true;

  document.getElementById("dt-target-pill").textContent = `TARGET: ${dtTargetCount} REPS`;
  document.getElementById("dt-mode-pill").textContent = "TAPPING PHASE";
  document.getElementById("dt-mode-pill").style.color = "";
  document.getElementById("dt-progress-fill").style.width = "0%";
  document.getElementById("dt-big-counter").textContent = `0 / ${dtTargetCount}`;
  
  const preBanner = document.getElementById("dt-prehold-banner");
  preBanner.classList.add("hidden");
  const preTitle = preBanner.querySelector(".prehold-title");
  if (preTitle) preTitle.textContent = "⚠️ INCOMING SURPRISE HOLD!";

  document.getElementById("dt-surprise-hold-box").classList.add("hidden");
  document.getElementById("dt-idle-alert").classList.add("hidden");

  setUnifiedGameState("pause", "TAP TO START REPS", dtWatchdogTimeoutSec > 0
    ? `Tap screen or cover sensor to advance reps. Inactivity past ${dtWatchdogTimeoutSec}s triggers shock!`
    : "Tap screen or cover sensor to advance reps. Watchdog is off.");
}

function stopReachCountGame() {
  clearInterval(dtPreHoldTicker);
  dtPreHoldTicker = null;
  clearInterval(dtSurpriseHoldTicker);
  clearInterval(dtWatchdogTicker);
  dtIsPreHoldActive = false;
  dtIsSurpriseHoldActive = false;
  const preBanner = document.getElementById("dt-prehold-banner");
  if (preBanner) preBanner.classList.add("hidden");
  stopPunishLoop();
}

function handleReachCountTap(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (config.inputSource === "touch") {
    handlePhysicalInputState(true);
  } else {
    if (isRepStrokeArmed) {
      advanceReachCountRep();
      isRepStrokeArmed = false;
    }
  }
}

function advanceReachCountRep() {
  if (dtCurrentReps >= dtTargetCount) return;

  // Advance rep
  dtCurrentReps++;
  dtLastRepTimestamp = Date.now();
  playTone(850, 40);

  // Clear any active stall punishment immediately on rep
  if (dtWatchdogTimeoutSec > 0 && !dtIsSurpriseHoldActive) {
    const arena = document.getElementById("dt-arena");
    if (arena && arena.classList.contains("punishing")) {
      arena.classList.remove("punishing");
      stopPunishLoop();
      document.getElementById("dt-idle-alert").classList.add("hidden");
    }
  }

  const counter = document.getElementById("dt-big-counter");
  if (counter) counter.textContent = `${dtCurrentReps} / ${dtTargetCount}`;
  const pct = Math.min(100, Math.round((dtCurrentReps / dtTargetCount) * 100));
  const fill = document.getElementById("dt-progress-fill");
  if (fill) fill.style.width = `${pct}%`;
  const label = document.getElementById("dt-state-label");
  if (label) label.textContent = `REP ${dtCurrentReps} • KEEP GOING!`;

  startReachCountWatchdog();

  // Check victory
  if (dtCurrentReps >= dtTargetCount) {
    stopReachCountGame();
    sendRewardOnce("reachcount");
    setUnifiedGameState("can-release", "🏆 CHALLENGE COMPLETE!", "Great work! Target reached flawlessly.");
    playTone(523, 120);
    setTimeout(() => playTone(659, 120), 120);
    setTimeout(() => playTone(784, 300), 240);
    return;
  }

  // Check Surprise Hold Trigger
  if (dtSurpriseProb > 0 && dtCurrentReps < dtTargetCount) {
    const roll = Math.random() * 100;
    if (roll < dtSurpriseProb) {
      triggerSurpriseHoldSequence();
    }
  }
}

// CRITICAL USER FIX: Advance 3s warning allows holding BEFORE surprise hold starts to avoid any punishment!
function triggerSurpriseHoldSequence() {
  dtIsPreHoldActive = true;
  clearInterval(dtWatchdogTicker);
  stopPunishLoop();

  const preBanner = document.getElementById("dt-prehold-banner");
  const preTitle = preBanner.querySelector(".prehold-title");
  const preNum = document.getElementById("dt-prehold-num");

  if (isPhysicalDown) {
    if (preTitle) preTitle.textContent = "✅ LOCKED IN! GET READY TO HOLD...";
    setUnifiedGameState("holding");
  } else {
    if (preTitle) preTitle.textContent = "⚠️ INCOMING SURPRISE HOLD!";
    setUnifiedGameState("must-hold");
  }

  preBanner.classList.remove("hidden");

  let preCount = 3;
  preNum.textContent = preCount;
  playTone(400, 150);

  clearInterval(dtPreHoldTicker);
  dtPreHoldTicker = setInterval(() => {
    preCount--;
    if (preCount > 0) {
      preNum.textContent = preCount;
      playTone(400 + (3 - preCount) * 200, 150);
    } else {
      clearInterval(dtPreHoldTicker);
      dtPreHoldTicker = null;
      preBanner.classList.add("hidden");
      dtIsPreHoldActive = false;
      startActualSurpriseHold();
    }
  }, 1000);
}

function startActualSurpriseHold() {
  dtIsSurpriseHoldActive = true;
  dtSurpriseHoldRemaining = dtSurpriseHoldSec;

  const holdBox = document.getElementById("dt-surprise-hold-box");
  const timer = document.getElementById("dt-surprise-hold-timer");

  document.getElementById("dt-mode-pill").textContent = "HOLD REQUIRED!";
  document.getElementById("dt-mode-pill").style.color = "var(--red-punish)";

  holdBox.classList.remove("hidden");
  timer.textContent = dtSurpriseHoldRemaining.toFixed(1);

  // USER FIX: If subject is already holding before the hold starts, do NOT punish!
  if (isPhysicalDown) {
    stopPunishLoop();
    playTone(600, 100);

    setUnifiedGameState("holding", "LOCKED IN! MAINTAIN HOLD!", `Already locked down! Hold for ${dtSurpriseHoldSec}s!`);

    clearInterval(dtSurpriseHoldTicker);
    dtSurpriseHoldTicker = setInterval(() => {
      if (isPhysicalDown && dtSurpriseHoldRemaining > 0) {
        dtSurpriseHoldRemaining = Math.max(0, dtSurpriseHoldRemaining - 0.1);
        timer.textContent = dtSurpriseHoldRemaining.toFixed(1);

        if (dtSurpriseHoldRemaining <= 0) {
          clearInterval(dtSurpriseHoldTicker);
          dtIsSurpriseHoldActive = false;
          document.getElementById("dt-surprise-hold-box").classList.add("hidden");
          document.getElementById("dt-mode-pill").textContent = "TAPPING PHASE";
          document.getElementById("dt-mode-pill").style.color = "";
          setUnifiedGameState("can-release", "HOLD CLEARED! RESUME TAPPING!", "Tap screen or cover sensor to advance reps. Stalling triggers shock!");
          playTone(880, 200);
          dtLastRepTimestamp = Date.now();
          startReachCountWatchdog();
        }
      }
    }, 100);

  } else {
    // Subject has not held down yet -> trigger punishment until pressed
    setUnifiedGameState("punish", "🚨 HOLD DOWN NOW!", `Maintain hold for ${dtSurpriseHoldSec}s! Releasing shocks!`);
    playTone(300, 300, "sawtooth");
    startPunishLoop(dtIntensity);
  }
}

function handleReachCountHoldLogic(isDown) {
  // If in pre-hold warning phase, update banner feedback on early press
  if (dtIsPreHoldActive) {
    const preBanner = document.getElementById("dt-prehold-banner");
    const preTitle = preBanner ? preBanner.querySelector(".prehold-title") : null;
    if (isDown) {
      if (preTitle) preTitle.textContent = "✅ LOCKED IN! GET READY TO HOLD...";
      setUnifiedGameState("holding");
      playTone(600, 60);
    } else {
      if (preTitle) preTitle.textContent = "⚠️ INCOMING SURPRISE HOLD!";
      setUnifiedGameState("must-hold");
    }
    return;
  }

  if (!dtIsSurpriseHoldActive) {
    if (isDown) {
      if (isRepStrokeArmed) {
        advanceReachCountRep();
        isRepStrokeArmed = false;
      }
    } else {
      if (config.inputSource !== "mediapipe") {
        isRepStrokeArmed = true;
      }
    }
    return;
  }

  const timer = document.getElementById("dt-surprise-hold-timer");

  if (isDown) {
    stopPunishLoop();
    playTone(600, 80);

    setUnifiedGameState("holding", "HOLDING... STAY LOCKED!");

    clearInterval(dtSurpriseHoldTicker);
    dtSurpriseHoldTicker = setInterval(() => {
      if (isPhysicalDown && dtSurpriseHoldRemaining > 0) {
        dtSurpriseHoldRemaining = Math.max(0, dtSurpriseHoldRemaining - 0.1);
        timer.textContent = dtSurpriseHoldRemaining.toFixed(1);

        if (dtSurpriseHoldRemaining <= 0) {
          clearInterval(dtSurpriseHoldTicker);
          dtIsSurpriseHoldActive = false;
          document.getElementById("dt-surprise-hold-box").classList.add("hidden");
          document.getElementById("dt-mode-pill").textContent = "TAPPING PHASE";
          document.getElementById("dt-mode-pill").style.color = "";
          setUnifiedGameState("can-release", "HOLD CLEARED! RESUME TAPPING!", "Tap screen or cover sensor to advance reps. Stalling triggers shock!");
          playTone(880, 200);
          dtLastRepTimestamp = Date.now();
          startReachCountWatchdog();
        }
      }
    }, 100);

  } else {
    clearInterval(dtSurpriseHoldTicker);

    if (dtSurpriseHoldRemaining > 0) {
      setUnifiedGameState("punish", "⚠️ RELEASED! FEEDBACK ACTIVE!");
      if (dtPenaltyReps > 0) {
        dtTargetCount += dtPenaltyReps;
        document.getElementById("dt-target-pill").textContent = `TARGET: ${dtTargetCount} REPS`;
        document.getElementById("dt-big-counter").textContent = `${dtCurrentReps} / ${dtTargetCount}`;
        const pct = Math.min(100, (dtCurrentReps / dtTargetCount) * 100);
        document.getElementById("dt-progress-fill").style.width = `${pct}%`;
      }
      startPunishLoop(dtIntensity);
    }
  }
}

function startReachCountWatchdog() {
  clearInterval(dtWatchdogTicker);
  const idleAlert = document.getElementById("dt-idle-alert");
  const idleNum = document.getElementById("dt-idle-num");
  idleAlert.classList.add("hidden");

  if (dtWatchdogTimeoutSec <= 0) return; // Watchdog disabled

  const warnThreshold = Math.max(0.5, dtWatchdogTimeoutSec - dtWatchdogWarnSec);

  dtWatchdogTicker = setInterval(() => {
    if (dtIsPreHoldActive || dtIsSurpriseHoldActive || dtCurrentReps >= dtTargetCount) {
      clearInterval(dtWatchdogTicker);
      return;
    }

    const elapsedSinceRep = (Date.now() - dtLastRepTimestamp) / 1000;
    if (elapsedSinceRep >= warnThreshold) {
      idleAlert.classList.remove("hidden");
      const secUntilShock = Math.max(0, Math.ceil(dtWatchdogTimeoutSec - elapsedSinceRep));
      idleNum.textContent = secUntilShock;

      if (elapsedSinceRep >= dtWatchdogTimeoutSec) {
        setUnifiedGameState("punish", "🚨 STALLED! TAP TO STOP SHOCK!", "Inactivity detected! Continuous shock active until you tap!");
        startPunishLoop(dtIntensity);
      } else {
        setUnifiedGameState("stalling");
      }
    } else {
      idleAlert.classList.add("hidden");
      if (!dtIsSurpriseHoldActive) {
        stopPunishLoop();
        setUnifiedGameState("pause");
      }
    }
  }, 100);
}

// ==========================================
// 7. GAME 4: PULSE RUNNER (PULSE RUNNER + BEAT DEBT TRACKING)
// ==========================================
let bpmTarget = 35;
let bpmMode = "standard";
let bpmCurrentTarget = 35;
let bpmSessionTargetDuration = 45;
let bpmSessionRemaining = 45;
let bpmPenaltyDelayTarget = 2.5;
let bpmTimeAddedTarget = 5;
let bpmDebtLimitPauseSec = 30; // 30s pause default for critical beat debt
let bpmIntensity = 20;

let bpmSessionTicker = null;
let bpmTapTimestamps = [];
let bpmDelayRemaining = 2.5;
let isBpmPunishingActive = false;
let bpmMetronomeTicker = null;

// Cumulative Beat Counter & Deficit State
let bpmActualBeats = 0;
let bpmExpectedBeats = 0;
let bpmExpectedBeatFraction = 0;
let bpmDebt = 0;
let isBpmCriticalDebtPunishing = false;

function initBpmGame() {
  document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-mode]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bpmMode = btn.getAttribute("data-bpm-mode");
    });
  });

  // Tempo presets
  document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-preset]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-preset]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bpmTarget = parseInt(btn.getAttribute("data-bpm-preset"), 10);
      document.getElementById("setup-bpm-slider").value = bpmTarget;
      document.getElementById("setup-bpm-slider-val").textContent = `${bpmTarget} BPM`;
    });
  });

  const bpmSlider = document.getElementById("setup-bpm-slider");
  bpmSlider.addEventListener("input", (e) => {
    bpmTarget = parseInt(e.target.value, 10);
    document.getElementById("setup-bpm-slider-val").textContent = `${bpmTarget} BPM`;
    document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-preset]").forEach(b => {
      b.classList.toggle("active", parseInt(b.getAttribute("data-bpm-preset"), 10) === bpmTarget);
    });
  });

  // Duration
  document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-duration]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-duration]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bpmSessionTargetDuration = parseInt(btn.getAttribute("data-bpm-duration"), 10);
    });
  });

  // Delay before penalty
  document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-delay]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-delay]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bpmPenaltyDelayTarget = parseFloat(btn.getAttribute("data-bpm-delay"));
    });
  });

  // Time added
  document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-timeadded]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-timeadded]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bpmTimeAddedTarget = parseInt(btn.getAttribute("data-bpm-timeadded"), 10);
    });
  });

  // Critical Beat Debt Limit
  document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-debtlimit]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-rhythm .pill-select[data-bpm-debtlimit]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bpmDebtLimitPauseSec = parseInt(btn.getAttribute("data-bpm-debtlimit"), 10);
    });
  });

  // Intensity slider
  const bpmIntSlider = document.getElementById("setup-bpm-intensity");
  bpmIntSlider.addEventListener("input", (e) => {
    bpmIntensity = parseInt(e.target.value, 10);
    document.getElementById("setup-bpm-intensity-val").textContent = `${bpmIntensity}%`;
  });

  document.getElementById("btn-play-rhythm").addEventListener("click", () => {
    switchScreen("game-rhythm");
  });

  const arena = document.getElementById("bpm-arena");
  arena.addEventListener("pointerdown", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (config.inputSource === "touch") {
      handlePhysicalInputState(true);
    } else {
      handleBpmTap(e);
    }
  });
}

function resetBpmGame() {
  stopBpmGame();
  isRepStrokeArmed = true;
  bpmSessionRemaining = bpmSessionTargetDuration;
  bpmTapTimestamps = [];
  bpmDelayRemaining = bpmPenaltyDelayTarget;
  isBpmPunishingActive = false;
  isBpmCriticalDebtPunishing = false;
  bpmActualBeats = 0;
  bpmExpectedBeats = 0;
  bpmExpectedBeatFraction = 0;
  bpmDebt = 0;
  bpmCurrentTarget = bpmMode === "intro" ? Math.max(15, Math.round(bpmTarget / 2)) : bpmTarget;

  document.getElementById("bpm-target-label").textContent = bpmCurrentTarget;
  const finalTarget = document.getElementById("bpm-final-target");
  finalTarget.textContent = ` / ${bpmTarget} BPM FINAL`;
  finalTarget.classList.toggle("hidden", bpmMode !== "intro");
  document.getElementById("bpm-session-timer").textContent = `${bpmSessionRemaining.toFixed(1)}s`;
  document.getElementById("bpm-live-val").textContent = "…";
  document.getElementById("bpm-delay-bar-container").classList.add("hidden");
  document.getElementById("bpm-penalty-tag").classList.add("hidden");

  const debtAlert = document.getElementById("bpm-debt-alert");
  if (debtAlert) debtAlert.classList.add("hidden");

  const beatsReadout = document.getElementById("bpm-beats-readout");
  if (beatsReadout) beatsReadout.textContent = "0 / 0";
  const debtVal = document.getElementById("bpm-debt-val");
  if (debtVal) debtVal.textContent = "0";

  const debtPill = document.getElementById("bpm-debt-pill");
  if (debtPill) {
    debtPill.classList.remove("has-debt", "critical-debt");
  }

  const progressBar = document.getElementById("bpm-progress-bar");
  if (progressBar) progressBar.style.width = "0%";

  refreshBpmCuePillIdle("bpm-pacer-cue");
  if (currentScreen === "game-rhythm") {
    startBpmPacer(bpmCurrentTarget, "bpm-pacer-cue", "bpm-arena", false);
    bpmMetronomeTicker = bpmPacerTicker;
  }

  setUnifiedGameState("pause", "START TAPPING TO BEGIN", bpmMode === "intro"
    ? `Start at ${bpmCurrentTarget} BPM. The pace rises to ${bpmTarget} BPM as you progress.`
    : "Follow the DOWN beat cue to match target BPM!");
}

function updateBpmIntroTarget() {
  if (bpmMode !== "intro") return;
  const completed = bpmSessionTargetDuration - Math.min(bpmSessionRemaining, bpmSessionTargetDuration);
  const progress = Math.min(1, completed / (bpmSessionTargetDuration * 0.75));
  const start = Math.max(15, Math.round(bpmTarget / 2));
  const nextTarget = Math.max(bpmCurrentTarget, Math.round(start + (bpmTarget - start) * progress));
  if (nextTarget === bpmCurrentTarget) return;
  bpmCurrentTarget = nextTarget;
  document.getElementById("bpm-target-label").textContent = bpmCurrentTarget;
  startBpmPacer(bpmCurrentTarget, "bpm-pacer-cue", "bpm-arena", false);
  bpmMetronomeTicker = bpmPacerTicker;
}

function stopBpmGame() {
  clearInterval(bpmSessionTicker);
  clearInterval(bpmMetronomeTicker);
  stopBpmPacer();
  bpmSessionTicker = null;
  bpmMetronomeTicker = null;
  isBpmCriticalDebtPunishing = false;
  const debtAlert = document.getElementById("bpm-debt-alert");
  if (debtAlert) debtAlert.classList.add("hidden");
  stopPunishLoop();
}

function startBpmEngines() {
  clearInterval(bpmMetronomeTicker);
  startBpmPacer(bpmCurrentTarget, "bpm-pacer-cue", "bpm-arena", false);
  bpmMetronomeTicker = bpmPacerTicker;

  clearInterval(bpmSessionTicker);
  bpmSessionTicker = setInterval(() => {
    const now = Date.now();
    const cadenceWindowMs = Math.max(3500, (120000 / bpmCurrentTarget) + 500);
    bpmTapTimestamps = bpmTapTimestamps.filter(t => now - t <= cadenceWindowMs);

    // 1. Live Instantaneous Cadence (sliding window)
    let liveBpm = 0;
    if (bpmTapTimestamps.length >= 2) {
      const duration = (bpmTapTimestamps[bpmTapTimestamps.length - 1] - bpmTapTimestamps[0]) / 1000;
      const count = bpmTapTimestamps.length - 1;
      if (duration > 0) liveBpm = Math.round((count / duration) * 60);
    }
    document.getElementById("bpm-live-val").textContent = liveBpm > 0 ? liveBpm : "…";

    // 2. Cumulative Expected vs Actual Beats & Debt Calculation
    bpmExpectedBeatFraction += bpmCurrentTarget / 600;
    bpmExpectedBeats = Math.floor(bpmExpectedBeatFraction);
    bpmDebt = Math.max(0, bpmExpectedBeats - bpmActualBeats);

    const beatsReadout = document.getElementById("bpm-beats-readout");
    if (beatsReadout) beatsReadout.textContent = `${bpmActualBeats} / ${bpmExpectedBeats}`;
    const debtVal = document.getElementById("bpm-debt-val");
    if (debtVal) debtVal.textContent = bpmDebt;

    // Threshold for persistent shock based on seconds of complete pause
    // e.g. at 80 BPM, a 30s pause = (30 * 80 / 60) = 40 beats deficit
    const criticalDebtThreshold = bpmDebtLimitPauseSec > 0
      ? Math.max(5, Math.round((bpmDebtLimitPauseSec * bpmCurrentTarget) / 60))
      : 999999;

    const isCriticalDebt = (bpmDebtLimitPauseSec > 0) && (bpmDebt >= criticalDebtThreshold);

    const debtPill = document.getElementById("bpm-debt-pill");
    const debtAlert = document.getElementById("bpm-debt-alert");
    const debtAlertCount = document.getElementById("bpm-debt-alert-count");

    if (debtPill) {
      debtPill.classList.toggle("has-debt", bpmDebt > 0);
      debtPill.classList.toggle("critical-debt", isCriticalDebt);
    }

    if (debtAlert) {
      debtAlert.classList.toggle("hidden", !isCriticalDebt);
      if (debtAlertCount) debtAlertCount.textContent = bpmDebt;
    }

    const delayContainer = document.getElementById("bpm-delay-bar-container");
    const delayNum = document.getElementById("bpm-delay-num");
    const delayFill = document.getElementById("bpm-delay-fill");

    const inFirstBeatWindow = bpmTapTimestamps.length === 1 &&
      (now - bpmTapTimestamps[0]) <= ((60000 / bpmCurrentTarget) * 1.25);
    const isPaceCompliant = inFirstBeatWindow || liveBpm >= (bpmCurrentTarget * 0.85);

    // 3. PERSISTENT SHOCK BRANCH: Critical Beat Debt Triggered
    if (isCriticalDebt) {
      // A large beat deficit keeps feedback active until the pace recovers.
      delayContainer.classList.add("hidden");
      setUnifiedGameState("punish", `🚨 CRITICAL DEBT: ${bpmDebt} BEATS BEHIND!`, `Persistent shock active! Speed up to clear debt under ${criticalDebtThreshold}!`);
      if (!isBpmCriticalDebtPunishing) {
        isBpmCriticalDebtPunishing = true;
        startPunishLoop(bpmIntensity);
      }
      return;
    } else {
      if (isBpmCriticalDebtPunishing) {
        isBpmCriticalDebtPunishing = false;
        stopPunishLoop();
      }
    }

    // 4. Normal Cadence Flow
    if (isPaceCompliant) {
      isBpmPunishingActive = false;
      stopPunishLoop();
      bpmDelayRemaining = bpmPenaltyDelayTarget;
      delayContainer.classList.add("hidden");

      if (bpmDebt > 0) {
        setUnifiedGameState("holding", `RECOVERING DEBT (${bpmDebt} BEHIND)`, "Speed up past target tempo to pay off accumulated beats!");
      } else {
        setUnifiedGameState("holding", "RIGHT ON BEAT");
      }

      bpmSessionRemaining = Math.max(0, bpmSessionRemaining - 0.1);
      updateBpmIntroTarget();
      document.getElementById("bpm-session-timer").textContent = `${bpmSessionRemaining.toFixed(1)}s`;
      const pct = Math.min(100, Math.max(0, ((bpmSessionTargetDuration - bpmSessionRemaining) / bpmSessionTargetDuration) * 100));
      const progressBar = document.getElementById("bpm-progress-bar");
      if (progressBar) progressBar.style.width = `${pct}%`;

      if (bpmSessionRemaining <= 0) {
        stopBpmGame();
        sendRewardOnce("rhythm");
        setUnifiedGameState("can-release", "🏆 PULSE RUNNER COMPLETE!", `Session cleared! Finished with ${bpmActualBeats} beats.`);
        playTone(523, 120);
        setTimeout(() => playTone(659, 120), 120);
        setTimeout(() => playTone(784, 300), 240);
      }
    } else {
      delayContainer.classList.remove("hidden");
      setUnifiedGameState("stalling", bpmDebt > 0 ? `FASTER! DEBT: ${bpmDebt} BEATS` : "FASTER! SPEED UP!");

      bpmDelayRemaining = Math.max(0, bpmDelayRemaining - 0.1);
      delayNum.textContent = `${bpmDelayRemaining.toFixed(1)}s`;
      delayFill.style.width = `${Math.min(100, (bpmDelayRemaining / bpmPenaltyDelayTarget) * 100)}%`;

      if (bpmDelayRemaining <= 0) {
        if (!isBpmPunishingActive) {
          isBpmPunishingActive = true;
          setUnifiedGameState("punish", "⚠️ FEEDBACK ACTIVE! TAP FASTER!");

          if (bpmTimeAddedTarget > 0) {
            bpmSessionRemaining += bpmTimeAddedTarget;
            document.getElementById("bpm-session-timer").textContent = `${bpmSessionRemaining.toFixed(1)}s`;
            const penaltyTag = document.getElementById("bpm-penalty-tag");
            penaltyTag.textContent = `+${bpmTimeAddedTarget}s PENALTY`;
            penaltyTag.classList.remove("hidden");
            setTimeout(() => penaltyTag.classList.add("hidden"), 1800);
          }

          startPunishLoop(bpmIntensity);
        }
      }
    }
  }, 100);
}

function handleBpmTap(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (bpmSessionRemaining <= 0) return;
  const now = Date.now();
  bpmTapTimestamps.push(now);
  bpmActualBeats++; // Register actual beat hit!
  playTone(800, 30);

  if (!bpmSessionTicker) {
    bpmDelayRemaining = Math.max(bpmPenaltyDelayTarget, 120 / bpmCurrentTarget);
    startBpmEngines();
  }
}

// ==========================================
// 8. GAME 5: HOLD SUMMIT (ESCALATING PUNISHMENT & PERFECT HOLD HALVING)
// ==========================================
let towerTotalFloors = 5;
let towerHoldSec = 15;
let towerBonusSec = 5; // Perfect Hold requires holding +5s longer in Bonus Zone
let towerBonusRemaining = 5;
let towerRestSec = 10;
let towerStartIntensity = 20;
let towerStepIntensity = 10;
let towerFailStep = 5; // Intensity increase per punishment/failure
let towerPenaltyIntensity = 0; // Accumulated punishment escalation
let towerFloorFails = 0; // Fails on current floor

let towerCurrentFloorIndex = 0;
let towerHoldRemaining = 15;
let towerTicker = null;
let towerPhase = "ready_to_hold"; // "ready_to_hold" | "holding" | "bonus_zone" | "resting" | "rest_expired" | "conquered"
let towerRestRemaining = 10;
let towerRestTicker = null;

function initTowerGame() {
  document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-floors]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-floors]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      towerTotalFloors = parseInt(btn.getAttribute("data-tower-floors"), 10);
    });
  });

  document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-hold-sec]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-hold-sec]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      towerHoldSec = parseInt(btn.getAttribute("data-tower-hold-sec"), 10);
    });
  });

  document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-bonus-sec]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-bonus-sec]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      towerBonusSec = parseInt(btn.getAttribute("data-tower-bonus-sec"), 10);
    });
  });

  document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-rest-sec]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-rest-sec]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      towerRestSec = parseInt(btn.getAttribute("data-tower-rest-sec"), 10);
    });
  });

  document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-startint]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-startint]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      towerStartIntensity = parseInt(btn.getAttribute("data-tower-startint"), 10);
    });
  });

  document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-stepint]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-stepint]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      towerStepIntensity = parseInt(btn.getAttribute("data-tower-stepint"), 10);
    });
  });

  document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-failstep]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tower .pill-select[data-tower-failstep]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      towerFailStep = parseInt(btn.getAttribute("data-tower-failstep"), 10);
    });
  });

  document.getElementById("btn-play-tower").addEventListener("click", () => {
    switchScreen("game-tower");
  });

  const arena = document.getElementById("tower-arena");
  arena.addEventListener("pointerdown", (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (config.inputSource === "touch") handlePhysicalInputState(true);
  });
}

function getTowerBaseIntensity(floorIdx) {
  return Math.min(99, towerStartIntensity + (floorIdx * towerStepIntensity));
}

function getTowerCurrentIntensity(floorIdx) {
  return Math.min(99, getTowerBaseIntensity(floorIdx) + towerPenaltyIntensity);
}

function hideTowerBanners() {
  const p = document.getElementById("tower-perfect-banner");
  if (p) p.classList.add("hidden");
  const f = document.getElementById("tower-fail-banner");
  if (f) f.classList.add("hidden");
}

function resetTowerState() {
  clearInterval(towerTicker);
  clearInterval(towerRestTicker);
  stopPunishLoop();
  towerCurrentFloorIndex = 0;
  towerHoldRemaining = towerHoldSec;
  towerBonusRemaining = towerBonusSec;
  towerPenaltyIntensity = 0;
  towerFloorFails = 0;
  towerPhase = "ready_to_hold";
  hideTowerBanners();
  updateTowerUI();
}

function updateTowerUI() {
  const floorNum = towerCurrentFloorIndex + 1;
  const currentIntensity = getTowerCurrentIntensity(towerCurrentFloorIndex);
  const isWebhook = config.outputMode === "webhook";

  document.getElementById("tower-floor-label").textContent = `FLOOR ${floorNum} OF ${towerTotalFloors}`;
  document.getElementById("tower-intensity-badge").textContent = `DEVICE: ${currentIntensity}%`;

  const penaltyBadge = document.getElementById("tower-penalty-badge");
  if (penaltyBadge) {
    if (!isWebhook && towerPenaltyIntensity > 0) {
      penaltyBadge.textContent = `+${towerPenaltyIntensity}% PENALTY`;
      penaltyBadge.classList.remove("hidden");
    } else {
      penaltyBadge.classList.add("hidden");
    }
  }

  document.getElementById("tower-bar-fill").style.width = `${(floorNum / towerTotalFloors) * 100}%`;

  if (towerPhase === "ready_to_hold") {
    document.getElementById("tower-big-timer").textContent = towerHoldRemaining.toFixed(1);
    setUnifiedGameState("must-hold", `FLOOR ${floorNum}: HOLD DOWN TO CLIMB`, `Hold for ${towerHoldSec}s to clear floor. Hold +${towerBonusSec}s longer in Bonus Zone to HALVE penalty!`);
  } else if (towerPhase === "holding") {
    document.getElementById("tower-big-timer").textContent = towerHoldRemaining.toFixed(1);
    setUnifiedGameState("holding");
  } else if (towerPhase === "bonus_zone") {
    document.getElementById("tower-big-timer").textContent = `BONUS: +${towerBonusRemaining.toFixed(1)}s`;
    setUnifiedGameState("can-release", "🌟 BONUS ZONE: HOLD LONGER TO HALVE PENALTY!", `Floor cleared! Hold for ${towerBonusRemaining.toFixed(1)}s more to earn PERFECT HOLD! Or release safely now.`);
  } else if (towerPhase === "resting") {
    if (towerRestRemaining <= 3) {
      setUnifiedGameState("stalling");
    } else {
      setUnifiedGameState("pause");
    }
  } else if (towerPhase === "rest_expired") {
    setUnifiedGameState("punish");
  } else if (towerPhase === "conquered") {
    setUnifiedGameState("can-release");
  }
}

function stopTowerGame() {
  clearInterval(towerTicker);
  clearInterval(towerRestTicker);
  stopPunishLoop();
}

function handleTowerLogic(isDown) {
  if (towerPhase === "conquered") return;
  const floorNum = towerCurrentFloorIndex + 1;
  const timer = document.getElementById("tower-big-timer");

  if (isDown) {
    // If resting or rest expired, pressing down starts next floor hold immediately!
    if (towerPhase === "resting" || towerPhase === "rest_expired") {
      clearInterval(towerRestTicker);
      stopPunishLoop();
      towerPhase = "holding";
      towerHoldRemaining = towerHoldSec; // Reset hold countdown!
      towerBonusRemaining = towerBonusSec;
      towerFloorFails = 0; // Fresh start for new floor!
      hideTowerBanners();
      updateTowerUI();
    } else if (towerPhase === "ready_to_hold") {
      towerPhase = "holding";
    }

    stopPunishLoop();
    playTone(600, 80);

    const currentIntensity = getTowerCurrentIntensity(towerCurrentFloorIndex);
    const isWebhook = config.outputMode === "webhook";
    setUnifiedGameState(
      "holding",
      `CLIMBING FLOOR ${floorNum}...`,
      isWebhook ? "Do not release until the floor timer clears!" : `Do not release! Current intensity: ${currentIntensity}%`
    );

    clearInterval(towerTicker);
    towerTicker = setInterval(() => {
      if (!isPhysicalDown) return;

      if (towerPhase === "holding") {
        towerHoldRemaining = Math.max(0, towerHoldRemaining - 0.1);
        timer.textContent = towerHoldRemaining.toFixed(1);

        if (towerHoldRemaining <= 0) {
          // Regular floor duration cleared!
          if (towerFloorFails === 0 && towerBonusSec > 0) {
            // Eligible for Perfect Hold bonus by holding longer!
            towerPhase = "bonus_zone";
            towerBonusRemaining = towerBonusSec;
            playTone(700, 100);
            setTimeout(() => playTone(880, 150), 100);
            updateTowerUI();
          } else {
            // Had early fails on this floor or no bonus duration: floor cleared without perfect bonus
            clearInterval(towerTicker);
            onTowerFloorCleared(false);
          }
        }
      } else if (towerPhase === "bonus_zone") {
        // Working down the extra bonus hold duration!
        towerBonusRemaining = Math.max(0, towerBonusRemaining - 0.1);
        timer.textContent = `BONUS: +${towerBonusRemaining.toFixed(1)}s`;
        updateTowerUI();

        if (towerBonusRemaining <= 0) {
          // Held longer all the way through the bonus zone! Perfect Hold achieved!
          clearInterval(towerTicker);
          onTowerFloorCleared(true);
        }
      }
    }, 100);

  } else {
    // Subject released
    if (towerPhase === "holding" && towerHoldRemaining > 0) {
      clearInterval(towerTicker);

      // PUNISHMENT ESCALATION: Intensity increases on punishment!
      towerFloorFails++;
      towerPenaltyIntensity = Math.min(79, towerPenaltyIntensity + towerFailStep);
      const currentIntensity = getTowerCurrentIntensity(towerCurrentFloorIndex);
      const isWebhook = config.outputMode === "webhook";

      // Show fail banner
      const failBanner = document.getElementById("tower-fail-banner");
      if (failBanner) {
        failBanner.textContent = isWebhook
          ? "⚠️ EARLY RELEASE! FEEDBACK TRIGGERED"
          : `⚠️ EARLY RELEASE! INTENSITY +${towerFailStep}% (NOW ${currentIntensity}%)`;
        failBanner.classList.remove("hidden");
        setTimeout(() => failBanner.classList.add("hidden"), 3000);
      }

      setUnifiedGameState(
        "punish",
        isWebhook ? "⚠️ RELEASED! FEEDBACK ACTIVE!" : `⚠️ RELEASED! FEEDBACK ACTIVE (${currentIntensity}%)!`,
        isWebhook ? "Put finger back down to resume!" : `Intensity escalated to ${currentIntensity}%! Put finger back down to resume!`
      );
      updateTowerUI();

      startPunishLoop(currentIntensity);

    } else if (towerPhase === "bonus_zone") {
      // Released during the bonus zone: Base floor was ALREADY cleared, so releasing is SAFE!
      // But they let go before earning the Perfect Hold halving.
      clearInterval(towerTicker);
      onTowerFloorCleared(false);
    }
  }
}

function onTowerFloorCleared(isPerfect = false) {
  if (isPerfect) {
    // PERFECT HOLD: Halves the accumulated punishment intensity!
    const oldPenalty = towerPenaltyIntensity;
    towerPenaltyIntensity = Math.floor(towerPenaltyIntensity / 2);

    const perfectBanner = document.getElementById("tower-perfect-banner");
    if (perfectBanner) {
      if (config.outputMode !== "webhook" && oldPenalty > 0) {
        perfectBanner.textContent = `🌟 PERFECT HOLD! HELD LONGER! PENALTY HALVED (+${oldPenalty}% ➔ +${towerPenaltyIntensity}%)!`;
      } else {
        perfectBanner.textContent = "🌟 PERFECT HOLD! HELD LONGER IN BONUS ZONE!";
      }
      perfectBanner.classList.remove("hidden");
      setTimeout(() => perfectBanner.classList.add("hidden"), 4000);
    }

    setUnifiedGameState("can-release", "🌟 PERFECT HOLD! BONUS COMPLETED!", "Flawless climb & held longer! You can release now.");

    playTone(523, 100);
    setTimeout(() => playTone(659, 100), 100);
    setTimeout(() => playTone(784, 150), 200);
    setTimeout(() => playTone(1046, 250), 350);
  } else {
    setUnifiedGameState("can-release", "FLOOR CLEARED! CAN RELEASE!", "Good job! Floor cleared.");
    playTone(880, 200);
  }

  if (towerCurrentFloorIndex < towerTotalFloors - 1) {
    towerCurrentFloorIndex++;
    towerPhase = "resting";
    towerRestRemaining = towerRestSec;
    towerHoldRemaining = towerHoldSec; // Pre-load next floor's duration!
    towerBonusRemaining = towerBonusSec;
    towerFloorFails = 0; // Fresh fail count for next floor

    const nextIntensity = getTowerCurrentIntensity(towerCurrentFloorIndex);
    const nextFloor = towerCurrentFloorIndex + 1;

    document.getElementById("tower-floor-label").textContent = `RESTING • NEXT: FLOOR ${nextFloor}`;
    document.getElementById("tower-intensity-badge").textContent = `NEXT: ${nextIntensity}%`;

    const penaltyBadge = document.getElementById("tower-penalty-badge");
    if (penaltyBadge) {
      if (config.outputMode !== "webhook" && towerPenaltyIntensity > 0) {
        penaltyBadge.textContent = `+${towerPenaltyIntensity}% PENALTY`;
        penaltyBadge.classList.remove("hidden");
      } else {
        penaltyBadge.classList.add("hidden");
      }
    }

    setUnifiedGameState("pause", isPerfect ? "🌟 PERFECT HOLD! REST PERIOD ACTIVE" : "FLOOR CLEARED! REST PERIOD ACTIVE", `Resting (${towerRestSec}s). Next floor hold +${towerBonusSec}s longer in Bonus Zone to halve penalty!`);
    document.getElementById("tower-big-timer").textContent = `${towerRestRemaining}s`;

    clearInterval(towerRestTicker);
    towerRestTicker = setInterval(() => {
      towerRestRemaining--;
      document.getElementById("tower-big-timer").textContent = `${towerRestRemaining}s`;

      if (towerRestRemaining > 0) {
        playTone(400, 50);
        if (towerRestRemaining <= 3) {
          setUnifiedGameState("stalling", `⚠️ REST ENDING IN ${towerRestRemaining}s!`, `Get ready to hold for Floor ${nextFloor}!`);
        }
      } else {
        clearInterval(towerRestTicker);
        towerPhase = "rest_expired";
        setUnifiedGameState("punish", `🚨 REST EXPIRED! HOLD DOWN FOR FLOOR ${nextFloor}!`, "Put finger down to start floor and stop the continuous shock!");
        startPunishLoop(nextIntensity);
      }
    }, 1000);

  } else {
    towerPhase = "conquered";
    sendRewardOnce("tower");
    setUnifiedGameState("can-release", "🏆 HOLD SUMMIT CONQUERED!", isPerfect ? "FLAWLESS HOLD SUMMIT! Incredible endurance." : "Hold Summit completed! Great job!");
    playTone(523, 150);
    setTimeout(() => playTone(659, 150), 150);
    setTimeout(() => playTone(784, 350), 300);
  }
}

// ==========================================
// 9. GAME 6: CIRCUIT QUEST (AUTHENTIC ROUTINE & PRESETS)
// ==========================================
const DTS_DIFFICULTY_PRESETS = {
  mild: [
    { title: "Gentle Rhythm Pacing", type: "bpm", duration: 20, bpm: 60 },
    { title: "Introductory Hold", type: "hold", duration: 15 },
    { title: "Steady Pacing", type: "bpm", duration: 20, bpm: 70 },
    { title: "Relaxed Finish Hold", type: "hold", duration: 15 }
  ],
  medium: [
    { title: "Warmup Rhythm", type: "bpm", duration: 25, bpm: 70 },
    { title: "Endurance Hold", type: "hold", duration: 20 },
    { title: "Focused Cadence", type: "bpm", duration: 25, bpm: 85 },
    { title: "Final Hold", type: "hold", duration: 25 }
  ],
  hard: [
    { title: "Rapid Pacing", type: "bpm", duration: 30, bpm: 80 },
    { title: "Steady Deep Hold", type: "hold", duration: 25 },
    { title: "Intense Cadence Pacing", type: "bpm", duration: 30, bpm: 95 },
    { title: "Heavy Endurance Hold", type: "hold", duration: 30 },
    { title: "Final Endurance Hold", type: "hold", duration: 30 }
  ],
  extreme: [
    { title: "High Speed Pacing", type: "bpm", duration: 30, bpm: 95 },
    { title: "Long Deep Hold", type: "hold", duration: 35 },
    { title: "Maximum Velocity Cadence", type: "bpm", duration: 30, bpm: 110 },
    { title: "Maximum Endurance Hold", type: "hold", duration: 40 },
    { title: "Final Challenge Hold", type: "hold", duration: 45 }
  ]
};

function getDtsExercises() {
  return DTS_DIFFICULTY_PRESETS[dtsDifficulty] || DTS_DIFFICULTY_PRESETS.medium;
}

function renderDtsPlanList() {
  const list = document.getElementById("dts-plan-list");
  if (!list) return;
  const exercises = getDtsExercises();
  list.innerHTML = exercises.map((ex, idx) => `
    <div class="routine-plan-item">
      <span class="plan-num">${idx + 1}</span>
      <span class="plan-name">${ex.title} (${ex.type === "hold" ? ex.duration + "s" : ex.bpm + " BPM"})</span>
      <span class="plan-badge">${ex.type === "hold" ? "HOLD" : "PACING"}</span>
    </div>
  `).join("");
}

let dtsCurrentIndex = 0;
let dtsTimerRemaining = 25;
let dtsTicker = null;
let dtsWatchdogTicker = null;
let dtsPhase = "ready";
let dtsWatchdogRestSec = 8;
let dtsIdleCount = 8;
let dtsDifficulty = "medium";

function initDtsGame() {
  // Difficulty pills
  document.querySelectorAll("#screen-setup-routine .pill-select[data-dts-diff]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-routine .pill-select[data-dts-diff]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dtsDifficulty = btn.getAttribute("data-dts-diff");
      renderDtsPlanList();
    });
  });

  // Watchdog rest pills
  document.querySelectorAll("#screen-setup-routine .pill-select[data-dts-rest]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-routine .pill-select[data-dts-rest]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dtsWatchdogRestSec = parseInt(btn.getAttribute("data-dts-rest"), 10);
    });
  });

  document.getElementById("btn-play-routine").addEventListener("click", () => {
    switchScreen("game-routine");
  });

  const arena = document.getElementById("dts-arena");
  arena.addEventListener("pointerdown", handleDtsInteraction);

  renderDtsPlanList();
}

function resetDtsGame() {
  stopDtsGame();
  isRepStrokeArmed = true;
  dtsCurrentIndex = 0;
  dtsPhase = "ready";
  updateDtsUI();
}

function updateDtsUI() {
  const exercises = getDtsExercises();
  const ex = exercises[dtsCurrentIndex];
  dtsTimerRemaining = ex.duration;
  document.getElementById("dts-step-pill").textContent = `STEP ${dtsCurrentIndex + 1} OF ${exercises.length}`;
  document.getElementById("dts-type-pill").textContent = ex.type === "hold" ? "HOLD EXERCISE" : `PACING (${ex.bpm} BPM)`;
  document.getElementById("dts-task-title").textContent = ex.title;
  document.getElementById("dts-big-timer").textContent = dtsTimerRemaining.toFixed(1);
  document.getElementById("dts-idle-alert").classList.add("hidden");

  const dtsCue = document.getElementById("dts-pacer-cue");
  if (ex.type === "hold") {
    if (dtsCue) dtsCue.classList.add("hidden");
    stopBpmPacer();
    setUnifiedGameState("must-hold", "HOLD DOWN TO START", "Maintain continuous deep hold.");
  } else {
    if (dtsCue) {
      dtsCue.classList.remove("hidden");
      refreshBpmCuePillIdle("dts-pacer-cue");
    }
    if (currentScreen === "game-routine" && dtsPhase === "ready") {
      startBpmPacer(ex.bpm, "dts-pacer-cue", "dts-arena", false);
    }
    setUnifiedGameState("pause", "TAP TO START PACING", "Follow the DOWN beat cue to match tempo.");
  }
}

function stopDtsGame() {
  clearInterval(dtsTicker);
  clearInterval(dtsWatchdogTicker);
  stopBpmPacer();
  const alertBox = document.getElementById("dts-idle-alert");
  if (alertBox) alertBox.classList.add("hidden");
  stopPunishLoop();
}

function handleDtsInteraction(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (dtsPhase === "complete") return;
  const ex = getDtsExercises()[dtsCurrentIndex];

  if (dtsPhase === "resting_watchdog") {
    stopDtsWatchdog();
    dtsPhase = "exercising";
    startDtsExerciseCountdown();
    return;
  }

  if (ex.type === "hold") {
    if (config.inputSource === "touch") handlePhysicalInputState(true);
  } else if (ex.type === "bpm") {
    playTone(900, 30);
    if (dtsPhase !== "exercising") {
      dtsPhase = "exercising";
      startDtsExerciseCountdown();
    }
  }
}

function handleDtsHoldLogic(isDown) {
  if (dtsPhase === "complete") return;
  const ex = getDtsExercises()[dtsCurrentIndex];
  if (!ex) return;

  if (dtsPhase === "resting_watchdog") {
    if (isDown) {
      stopDtsWatchdog();
      dtsPhase = "exercising";
      startDtsExerciseCountdown();
    }
    return;
  }

  if (ex.type === "bpm") {
    if (isDown) {
      if (isRepStrokeArmed) {
        handleDtsInteraction();
        isRepStrokeArmed = false;
      }
    } else {
      if (config.inputSource !== "mediapipe") {
        isRepStrokeArmed = true;
      }
    }
    return;
  }

  if (ex.type !== "hold") return;

  if (isDown) {
    stopPunishLoop();
    playTone(600, 80);

    if (dtsPhase !== "exercising") {
      dtsPhase = "exercising";
      startDtsExerciseCountdown();
    }
    setUnifiedGameState("holding", "HOLDING... STAY LOCKED", "Maintain deep contact!");
  } else {
    clearInterval(dtsTicker);
    if (dtsPhase === "exercising" && dtsTimerRemaining > 0) {
      setUnifiedGameState("punish", "⚠️ RELEASED! FEEDBACK ACTIVE!", "Continuous shock until held down!");
      startPunishLoop();
    }
  }
}

function startDtsExerciseCountdown() {
  clearInterval(dtsTicker);
  const timer = document.getElementById("dts-big-timer");
  const ex = getDtsExercises()[dtsCurrentIndex];

  if (ex && ex.type === "bpm") {
    startBpmPacer(ex.bpm, "dts-pacer-cue", "dts-arena", false);
  } else {
    stopBpmPacer();
  }

  setUnifiedGameState("holding");
  stopPunishLoop();

  dtsTicker = setInterval(() => {
    if (dtsTimerRemaining > 0) {
      dtsTimerRemaining = Math.max(0, dtsTimerRemaining - 0.1);
      timer.textContent = dtsTimerRemaining.toFixed(1);

      if (dtsTimerRemaining <= 0) {
        clearInterval(dtsTicker);
        onDtsExerciseCompleted();
      }
    }
  }, 100);
}

function onDtsExerciseCompleted() {
  stopBpmPacer();
  playTone(880, 200);
  const exercises = getDtsExercises();

  if (dtsCurrentIndex < exercises.length - 1) {
    dtsCurrentIndex++;
    dtsPhase = "resting_watchdog";
    dtsIdleCount = dtsWatchdogRestSec;

    updateDtsUI();
    const alertBox = document.getElementById("dts-idle-alert");
    alertBox.classList.remove("hidden");
    document.getElementById("dts-idle-count").textContent = dtsIdleCount;
    setUnifiedGameState("can-release", "TASK COMPLETE! RESTING...", "Breathe before the next exercise starts.");

    clearInterval(dtsWatchdogTicker);
    dtsWatchdogTicker = setInterval(() => {
      dtsIdleCount--;
      document.getElementById("dts-idle-count").textContent = dtsIdleCount;

      if (dtsIdleCount > 0) {
        playTone(400, 60);
        if (dtsIdleCount <= 3) {
          setUnifiedGameState("stalling", `⚠️ REST ENDING IN ${dtsIdleCount}s!`, "Start next task before shock!");
        } else {
          setUnifiedGameState("pause");
        }
      } else {
        clearInterval(dtsWatchdogTicker);
        setUnifiedGameState("punish", "🚨 WATCHDOG: START NEXT TASK NOW!", "Inactivity detected! Continuous shock active until started!");
        startPunishLoop();
      }
    }, 1000);

  } else {
    dtsPhase = "complete";
    sendRewardOnce("routine");
    setUnifiedGameState("can-release", "🏆 CIRCUIT QUEST COMPLETE!", "All routine exercises completed. Well done!");
    playTone(523, 150);
    setTimeout(() => playTone(659, 150), 150);
    setTimeout(() => playTone(784, 350), 300);
  }
}

function stopDtsWatchdog() {
  clearInterval(dtsWatchdogTicker);
  document.getElementById("dts-idle-alert").classList.add("hidden");
  stopPunishLoop();
}

// ==========================================
// 9.5 GAME 7: HIDDEN TIMER (THE VOID / DEEP HOLD)
// ==========================================
let bhMinSec = 20;
let bhMaxSec = 60;
let bhTotalRounds = 5; // 0 = endless
let bhRestSec = 15;
let bhAudioMode = "rising"; // "rising" | "heartbeat" | "silent"
let bhPenaltyMode = "+10"; // "+10" | "+15" | "restart"
let bhIntensity = 20;

let bhCurrentRound = 1;
let bhTargetSec = 30;
let bhHoldRemaining = 30;
let bhRestRemaining = 15;
let bhRestWarningRemaining = 3;
let bhPhase = "ready"; // "ready" | "holding" | "resting" | "rest_warning" | "rest_expired" | "failed" | "won"

let bhTicker = null;
let bhRestTicker = null;
let bhHeartbeatTicker = null;
let bhOscNode = null;
let bhGainNode = null;

function initBlindHiltGame() {
  // Min Hold Duration Pills
  document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-min]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-min]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bhMinSec = parseInt(btn.getAttribute("data-bh-min"), 10);

      if (bhMinSec > bhMaxSec) {
        bhMaxSec = bhMinSec;
        document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-max]").forEach(b => {
          b.classList.toggle("active", parseInt(b.getAttribute("data-bh-max"), 10) === bhMaxSec);
        });
      }
    });
  });

  // Max Hold Duration Pills
  document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-max]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-max]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bhMaxSec = parseInt(btn.getAttribute("data-bh-max"), 10);

      if (bhMaxSec < bhMinSec) {
        bhMinSec = bhMaxSec;
        document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-min]").forEach(b => {
          b.classList.toggle("active", parseInt(b.getAttribute("data-bh-min"), 10) === bhMinSec);
        });
      }
    });
  });

  // Total Rounds Pills
  document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-rounds]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-rounds]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bhTotalRounds = parseInt(btn.getAttribute("data-bh-rounds"), 10);
    });
  });

  // Rest Interval Pills
  document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-rest]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-rest]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bhRestSec = parseInt(btn.getAttribute("data-bh-rest"), 10);
    });
  });

  // Audio Cue Mode Pills
  const audioHint = document.getElementById("bh-audio-hint");
  document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-audio]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-audio]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bhAudioMode = btn.getAttribute("data-bh-audio");
      if (audioHint) {
        if (bhAudioMode === "rising") {
          audioHint.textContent = "A low tone gently rises as the release cue approaches.";
        } else if (bhAudioMode === "heartbeat") {
          audioHint.textContent = "Rhythmic 45 BPM heartbeat thuds to pace slow, controlled nose breathing.";
        } else {
          audioHint.textContent = "Complete sensory silence. Total unpredictability until the release gong.";
        }
      }
    });
  });

  // Penalty Mode Pills
  document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-penalty]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-blindhilt .pill-select[data-bh-penalty]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      bhPenaltyMode = btn.getAttribute("data-bh-penalty");
    });
  });

  // Intensity Slider
  const slider = document.getElementById("setup-bh-intensity");
  if (slider) {
    slider.addEventListener("input", (e) => {
      bhIntensity = parseInt(e.target.value, 10);
      document.getElementById("setup-bh-intensity-val").textContent = `${bhIntensity}%`;
    });
  }

  // Play Button
  const playBtn = document.getElementById("btn-play-blindhilt");
  if (playBtn) {
    playBtn.addEventListener("click", () => switchScreen("game-blindhilt"));
  }

  // Touch Arena
  const arena = document.getElementById("bh-arena");
  if (arena) {
    arena.addEventListener("pointerdown", (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (config.inputSource === "touch") handlePhysicalInputState(true);
    });
  }
}

function pickNewBlindHiltTarget() {
  const min = Math.min(bhMinSec, bhMaxSec);
  const max = Math.max(bhMinSec, bhMaxSec);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resetBlindHiltState() {
  stopBlindHiltGame();
  bhCurrentRound = 1;
  bhTargetSec = pickNewBlindHiltTarget();
  bhHoldRemaining = bhTargetSec;
  bhPhase = "ready";
  updateBlindHiltUI();
}

function stopBlindHiltGame() {
  if (bhTicker) {
    clearInterval(bhTicker);
    bhTicker = null;
  }
  if (bhRestTicker) {
    clearInterval(bhRestTicker);
    bhRestTicker = null;
  }
  stopBlindHiltAudio();
  stopPunishLoop();
  const alertBox = document.getElementById("bh-idle-alert");
  if (alertBox) alertBox.classList.add("hidden");
}

function startBlindHiltAudio(durationSec) {
  stopBlindHiltAudio();
  if (bhAudioMode === "silent") return;

  try {
    const ctx = getAudio();
    if (bhAudioMode === "rising") {
      bhOscNode = ctx.createOscillator();
      bhGainNode = ctx.createGain();
      bhOscNode.type = "sine";
      bhOscNode.frequency.setValueAtTime(75, ctx.currentTime);
      bhOscNode.frequency.exponentialRampToValueAtTime(240, ctx.currentTime + Math.max(1, durationSec));
      bhGainNode.gain.setValueAtTime(0.12, ctx.currentTime);
      bhOscNode.connect(bhGainNode);
      bhGainNode.connect(ctx.destination);
      bhOscNode.start();
    } else if (bhAudioMode === "heartbeat") {
      playHeartbeatPulse();
      bhHeartbeatTicker = setInterval(() => {
        if (bhPhase === "holding") playHeartbeatPulse();
      }, 1300);
    }
  } catch (e) {}
}

function stopBlindHiltAudio() {
  if (bhOscNode) {
    try {
      bhOscNode.stop();
      bhOscNode.disconnect();
    } catch (e) {}
    bhOscNode = null;
  }
  if (bhGainNode) {
    try { bhGainNode.disconnect(); } catch (e) {}
    bhGainNode = null;
  }
  if (bhHeartbeatTicker) {
    clearInterval(bhHeartbeatTicker);
    bhHeartbeatTicker = null;
  }
}

function playHeartbeatPulse() {
  try {
    const ctx = getAudio();
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = "sine";
    o1.frequency.setValueAtTime(60, ctx.currentTime);
    o1.frequency.exponentialRampToValueAtTime(32, ctx.currentTime + 0.12);
    g1.gain.setValueAtTime(0.22, ctx.currentTime);
    g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    o1.connect(g1);
    g1.connect(ctx.destination);
    o1.start();
    o1.stop(ctx.currentTime + 0.13);

    setTimeout(() => {
      if (bhPhase !== "holding") return;
      try {
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = "sine";
        o2.frequency.setValueAtTime(48, ctx.currentTime);
        o2.frequency.exponentialRampToValueAtTime(25, ctx.currentTime + 0.14);
        g2.gain.setValueAtTime(0.18, ctx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
        o2.connect(g2);
        g2.connect(ctx.destination);
        o2.start();
        o2.stop(ctx.currentTime + 0.15);
      } catch (e) {}
    }, 150);
  } catch (e) {}
}

function updateBlindHiltUI() {
  const roundPill = document.getElementById("bh-round-pill");
  const intensityPill = document.getElementById("bh-intensity-pill");
  const progressFill = document.getElementById("bh-progress-fill");
  const voidOrb = document.getElementById("bh-void-orb");
  const voidIcon = document.getElementById("bh-void-icon");
  const mainText = document.getElementById("bh-main-text");
  const idleAlert = document.getElementById("bh-idle-alert");

  if (!roundPill) return;

  const totalStr = bhTotalRounds === 0 ? "∞" : bhTotalRounds;
  roundPill.textContent = `ROUND ${bhCurrentRound} / ${totalStr}`;
  intensityPill.textContent = `DEVICE: ${bhIntensity}%`;

  if (bhTotalRounds > 0) {
    const pct = Math.min(100, Math.max(0, ((bhCurrentRound - 1) / bhTotalRounds) * 100));
    progressFill.style.width = `${pct}%`;
  } else {
    progressFill.style.width = "50%";
  }

  if (voidOrb) {
    voidOrb.classList.remove("void-holding", "void-punish", "void-resting");
  }

  if (bhPhase === "ready") {
    if (idleAlert) idleAlert.classList.add("hidden");
    if (voidIcon) voidIcon.textContent = "🔒";
    if (mainText) mainText.textContent = "IN THE VOID";
    setUnifiedGameState("pause", "HOLD DOWN AT FULL TARGET TO START", "Timer is hidden. Hold unbroken contact until release chime.");
  } else if (bhPhase === "holding") {
    if (idleAlert) idleAlert.classList.add("hidden");
    if (voidOrb) voidOrb.classList.add("void-holding");
    if (voidIcon) voidIcon.textContent = "👁️";
    if (mainText) mainText.textContent = "IN THE VOID";
    setUnifiedGameState("must-hold", "HOLDING AT TARGET (DO NOT RETREAT!)", "Keep a steady hold until the release cue.");
  } else if (bhPhase === "resting") {
    if (idleAlert) idleAlert.classList.add("hidden");
    if (voidOrb) voidOrb.classList.add("void-resting");
    if (voidIcon) voidIcon.textContent = "🌬️";
    if (mainText) mainText.textContent = `REST: ${Math.max(0, bhRestRemaining).toFixed(1)}s`;
    setUnifiedGameState("can-release", "ROUND COMPLETE • REST", "You may release and rest before the next round.");
  } else if (bhPhase === "rest_warning") {
    if (idleAlert) idleAlert.classList.remove("hidden");
    const alertNum = document.getElementById("bh-idle-num");
    if (alertNum) alertNum.textContent = Math.ceil(bhRestWarningRemaining);
    if (voidOrb) voidOrb.classList.add("void-resting");
    if (voidIcon) voidIcon.textContent = "⚠️";
    if (mainText) mainText.textContent = `PREPARE: ${Math.max(0, bhRestWarningRemaining).toFixed(1)}s`;
    setUnifiedGameState("stalling", "REST ENDING • RETURN TO TARGET!", `Resume hold within ${Math.ceil(bhRestWarningRemaining)}s or shock punishment starts!`);
  } else if (bhPhase === "rest_expired") {
    if (idleAlert) idleAlert.classList.remove("hidden");
    const alertNum = document.getElementById("bh-idle-num");
    if (alertNum) alertNum.textContent = "0";
    if (voidOrb) voidOrb.classList.add("void-punish");
    if (voidIcon) voidIcon.textContent = "⚡";
    if (mainText) mainText.textContent = "FEEDBACK ACTIVE!";
    setUnifiedGameState("punish", "REST EXPIRED! RETURN TO TARGET!", "Selected feedback continues until you return to the target position.");
  } else if (bhPhase === "failed") {
    if (idleAlert) idleAlert.classList.add("hidden");
    if (voidOrb) voidOrb.classList.add("void-punish");
    if (voidIcon) voidIcon.textContent = "⚡";
    if (mainText) mainText.textContent = "EARLY RELEASE!";
    setUnifiedGameState("punish", "PREMATURE RELEASE! RETURN TO TARGET!", "Selected feedback is active. Return to the target position to continue.");
  } else if (bhPhase === "won") {
    if (idleAlert) idleAlert.classList.add("hidden");
    if (voidOrb) voidOrb.classList.add("void-resting");
    if (voidIcon) voidIcon.textContent = "👑";
    if (mainText) mainText.textContent = "VICTORY";
    progressFill.style.width = "100%";
    setUnifiedGameState("can-release", "SESSION COMPLETE!", "All rounds complete. You may release.");
  }
}

function handleBlindHiltLogic(isDown) {
  if (bhPhase === "won") return;

  if (isDown) {
    stopPunishLoop();

    if (bhPhase === "ready" || bhPhase === "failed" || bhPhase === "resting" || bhPhase === "rest_warning" || bhPhase === "rest_expired") {
      if (bhRestTicker) {
        clearInterval(bhRestTicker);
        bhRestTicker = null;
      }
      playTone(550, 90);
      bhPhase = "holding";
      startBlindHiltAudio(bhHoldRemaining);
      startBlindHiltHoldTicker();
      updateBlindHiltUI();
    }
  } else {
    if (bhPhase === "holding") {
      stopBlindHiltAudio();
      if (bhTicker) {
        clearInterval(bhTicker);
        bhTicker = null;
      }
      bhPhase = "failed";

      if (bhPenaltyMode === "+10") {
        bhHoldRemaining += 10;
        bhTargetSec += 10;
      } else if (bhPenaltyMode === "+15") {
        bhHoldRemaining += 15;
        bhTargetSec += 15;
      } else if (bhPenaltyMode === "restart") {
        bhTargetSec = pickNewBlindHiltTarget();
        bhHoldRemaining = bhTargetSec;
      }

      updateBlindHiltUI();
      startPunishLoop(bhIntensity);
    }
  }
}

function startBlindHiltHoldTicker() {
  if (bhTicker) clearInterval(bhTicker);

  bhTicker = setInterval(() => {
    if (bhPhase !== "holding") return;

    bhHoldRemaining = Math.max(0, bhHoldRemaining - 0.1);

    if (bhHoldRemaining <= 0) {
      clearInterval(bhTicker);
      bhTicker = null;
      stopBlindHiltAudio();
      onBlindHiltRoundCleared();
    }
  }, 100);
}

function onBlindHiltRoundCleared() {
  playTone(528, 300, "sine");
  setTimeout(() => playTone(880, 500, "sine"), 180);

  if (bhTotalRounds > 0 && bhCurrentRound >= bhTotalRounds) {
    bhPhase = "won";
    sendRewardOnce("blindhilt");
    updateBlindHiltUI();
  } else {
    bhPhase = "resting";
    bhCurrentRound++;
    bhTargetSec = pickNewBlindHiltTarget();
    bhHoldRemaining = bhTargetSec;
    bhRestRemaining = bhRestSec;
    bhRestWarningRemaining = 3;
    updateBlindHiltUI();
    startBlindHiltRestTicker();
  }
}

function startBlindHiltRestTicker() {
  if (bhRestTicker) clearInterval(bhRestTicker);

  bhRestTicker = setInterval(() => {
    if (bhPhase === "resting") {
      bhRestRemaining = Math.max(0, bhRestRemaining - 0.1);
      const mainText = document.getElementById("bh-main-text");
      if (mainText) mainText.textContent = `REST: ${bhRestRemaining.toFixed(1)}s`;

      if (bhRestRemaining <= 0) {
        bhPhase = "rest_warning";
        bhRestWarningRemaining = 3;
        updateBlindHiltUI();
      }
    } else if (bhPhase === "rest_warning") {
      bhRestWarningRemaining = Math.max(0, bhRestWarningRemaining - 0.1);
      const alertNum = document.getElementById("bh-idle-num");
      if (alertNum) alertNum.textContent = Math.ceil(bhRestWarningRemaining);
      const mainText = document.getElementById("bh-main-text");
      if (mainText) mainText.textContent = `PREPARE: ${bhRestWarningRemaining.toFixed(1)}s`;

      if (bhRestWarningRemaining <= 0) {
        bhPhase = "rest_expired";
        updateBlindHiltUI();
        startPunishLoop(bhIntensity);
      }
    }
  }, 100);
}

// ==========================================
// 10. GAME 8: TEMPO ASCENT (ACCELERATING PACING & DEEP HOLDS)
// ==========================================
let teTotalStages = 5;
let teStartBpm = 30;
let teStepBpm = 8;
let tePacingDurationSec = 20;
let teHoldDurationSec = 12;
let teRestDurationSec = 8;
let teStartIntensity = 20;
let teStepIntensity = 8;

let teCurrentStage = 1;
let tePhase = "ready"; // "ready" | "pacing" | "prehold" | "holding" | "resting" | "rest_warning" | "rest_expired" | "won"
let tePhaseRemaining = 20;
let tePreHoldRemaining = 3;
let teHoldRemaining = 12;
let teRestRemaining = 8;
let teRestWarningRemaining = 3;

let teTicker = null;
let teMetronomeTicker = null;
let teTapTimestamps = [];
let teDelayRemaining = 2.0;
let teIsPacingPunishing = false;

let teActualBeats = 0;
let teExpectedBeats = 0;
let teElapsedPacingSec = 0;
let teDebt = 0;

function getTeStageBpm(stageIdx) {
  return teStartBpm + ((stageIdx - 1) * teStepBpm);
}

function getTeStageIntensity(stageIdx) {
  return Math.min(99, teStartIntensity + ((stageIdx - 1) * teStepIntensity));
}

function initTempoEscalationGame() {
  // Stages selector
  document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-stages]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-stages]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      teTotalStages = parseInt(btn.getAttribute("data-te-stages"), 10);
    });
  });

  // Start & Step BPM
  document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-startbpm]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-startbpm]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      teStartBpm = parseInt(btn.getAttribute("data-te-startbpm"), 10);
      teStepBpm = parseInt(btn.getAttribute("data-te-stepbpm"), 10);
    });
  });

  // Pacing Duration
  document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-pacing-sec]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-pacing-sec]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      tePacingDurationSec = parseInt(btn.getAttribute("data-te-pacing-sec"), 10);
    });
  });

  // Hold Duration
  document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-hold-sec]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-hold-sec]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      teHoldDurationSec = parseInt(btn.getAttribute("data-te-hold-sec"), 10);
    });
  });

  // Rest Duration
  document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-rest-sec]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-rest-sec]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      teRestDurationSec = parseInt(btn.getAttribute("data-te-rest-sec"), 10);
    });
  });

  // Intensity & Step
  document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-startint]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#screen-setup-tempoescalation .pill-select[data-te-startint]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      teStartIntensity = parseInt(btn.getAttribute("data-te-startint"), 10);
      teStepIntensity = parseInt(btn.getAttribute("data-te-stepint"), 10);
    });
  });

  // Play Button
  const playBtn = document.getElementById("btn-play-tempoescalation");
  if (playBtn) {
    playBtn.addEventListener("click", () => switchScreen("game-tempoescalation"));
  }

  // Touch Arena
  const arena = document.getElementById("te-arena");
  if (arena) {
    arena.addEventListener("pointerdown", (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (config.inputSource === "touch") {
        handlePhysicalInputState(true);
      } else {
        handleTempoEscalationTap();
      }
    });
  }
}

function resetTempoEscalationState() {
  stopTempoEscalationGame();
  isRepStrokeArmed = true;
  teCurrentStage = 1;
  tePhase = "ready";
  tePhaseRemaining = tePacingDurationSec;
  tePreHoldRemaining = 3;
  teHoldRemaining = teHoldDurationSec;
  teRestRemaining = teRestDurationSec;
  teRestWarningRemaining = 3;
  teTapTimestamps = [];
  teDelayRemaining = 2.0;
  teIsPacingPunishing = false;
  teActualBeats = 0;
  teExpectedBeats = 0;
  teElapsedPacingSec = 0;
  teDebt = 0;
  const preBanner = document.getElementById("te-prehold-banner");
  if (preBanner) preBanner.classList.add("hidden");
  refreshBpmCuePillIdle("te-pacer-cue");
  updateTempoEscalationUI();
  if (currentScreen === "game-tempoescalation") {
    startBpmPacer(getTeStageBpm(teCurrentStage), "te-pacer-cue", "te-arena", false);
    teMetronomeTicker = bpmPacerTicker;
  }
}

function stopTempoEscalationGame() {
  if (teTicker) {
    clearInterval(teTicker);
    teTicker = null;
  }
  if (teMetronomeTicker) {
    clearInterval(teMetronomeTicker);
    teMetronomeTicker = null;
  }
  stopBpmPacer();
  teIsPacingPunishing = false;
  stopPunishLoop();
  const preBanner = document.getElementById("te-prehold-banner");
  if (preBanner) preBanner.classList.add("hidden");
  const alertBox = document.getElementById("te-idle-alert");
  if (alertBox) alertBox.classList.add("hidden");
}

function updateTempoEscalationUI() {
  const stagePill = document.getElementById("te-stage-pill");
  const phaseBadge = document.getElementById("te-phase-badge");
  const intensityPill = document.getElementById("te-intensity-pill");
  const progressFill = document.getElementById("te-progress-fill");
  const phaseTimer = document.getElementById("te-phase-timer");
  const beatsReadout = document.getElementById("te-beats-readout");
  const debtVal = document.getElementById("te-debt-val");
  const debtPill = document.getElementById("te-debt-pill");
  const cadenceBox = document.getElementById("te-cadence-box");
  const holdBox = document.getElementById("te-hold-box");
  const targetBpmEl = document.getElementById("te-target-bpm");
  const delayBox = document.getElementById("te-delay-box");
  const idleAlert = document.getElementById("te-idle-alert");
  const preBanner = document.getElementById("te-prehold-banner");
  const pacerCue = document.getElementById("te-pacer-cue");

  const curBpm = getTeStageBpm(teCurrentStage);
  const curIntensity = getTeStageIntensity(teCurrentStage);

  if (pacerCue) {
    pacerCue.classList.toggle("hidden", !(tePhase === "ready" || tePhase === "pacing"));
  }

  if (stagePill) stagePill.textContent = `STAGE ${teCurrentStage} OF ${teTotalStages}`;
  if (intensityPill) intensityPill.textContent = `DEVICE: ${curIntensity}%`;
  if (targetBpmEl) targetBpmEl.textContent = `${curBpm} BPM`;

  // Overall Stage Progress
  if (progressFill) {
    const stageBasePct = ((teCurrentStage - 1) / teTotalStages) * 100;
    let intraStagePct = 0;
    if (tePhase === "pacing") {
      intraStagePct = ((tePacingDurationSec - tePhaseRemaining) / tePacingDurationSec) * (50 / teTotalStages);
    } else if (tePhase === "prehold") {
      intraStagePct = (50 / teTotalStages);
    } else if (tePhase === "holding") {
      intraStagePct = (50 / teTotalStages) + (((teHoldDurationSec - teHoldRemaining) / teHoldDurationSec) * (50 / teTotalStages));
    } else if (tePhase === "won") {
      intraStagePct = (100 / teTotalStages);
    }
    progressFill.style.width = `${Math.min(100, stageBasePct + intraStagePct)}%`;
  }

  if (beatsReadout) beatsReadout.textContent = `${teActualBeats} / ${teExpectedBeats}`;
  if (debtVal) debtVal.textContent = teDebt;
  if (debtPill) debtPill.classList.toggle("has-debt", teDebt > 0);

  if (tePhase === "ready") {
    if (phaseBadge) {
      phaseBadge.textContent = "PACING PHASE";
      phaseBadge.style.borderColor = "var(--crimson-accent)";
      phaseBadge.style.color = "var(--crimson-accent)";
    }
    if (cadenceBox) cadenceBox.classList.remove("hidden");
    if (holdBox) holdBox.classList.add("hidden");
    if (phaseTimer) phaseTimer.textContent = `${tePacingDurationSec.toFixed(1)}s`;
    if (delayBox) delayBox.classList.add("hidden");
    if (idleAlert) idleAlert.classList.add("hidden");
    if (preBanner) preBanner.classList.add("hidden");
    setUnifiedGameState("pause", `STAGE ${teCurrentStage}: TAP TO PACE AT ${curBpm} BPM`, "Match the accelerating beat before the final hold.");
  } else if (tePhase === "pacing") {
    if (phaseBadge) {
      phaseBadge.textContent = `PACING (${curBpm} BPM)`;
      phaseBadge.style.borderColor = "var(--crimson-accent)";
      phaseBadge.style.color = "var(--crimson-accent)";
    }
    if (cadenceBox) cadenceBox.classList.remove("hidden");
    if (holdBox) holdBox.classList.add("hidden");
    if (phaseTimer) phaseTimer.textContent = `${Math.max(0, tePhaseRemaining).toFixed(1)}s`;
    if (idleAlert) idleAlert.classList.add("hidden");
    if (preBanner) preBanner.classList.add("hidden");
  } else if (tePhase === "prehold") {
    if (phaseBadge) {
      phaseBadge.textContent = "⚠️ LOCK INCOMING";
      phaseBadge.style.borderColor = "var(--amber-warning)";
      phaseBadge.style.color = "var(--amber-warning)";
    }
    if (cadenceBox) cadenceBox.classList.add("hidden");
    if (holdBox) holdBox.classList.remove("hidden");
    const holdTimer = document.getElementById("te-hold-timer");
    if (holdTimer) holdTimer.textContent = `READY: ${Math.ceil(tePreHoldRemaining)}s`;
    if (phaseTimer) phaseTimer.textContent = `LOCK IN: ${Math.ceil(tePreHoldRemaining)}s`;
    if (delayBox) delayBox.classList.add("hidden");
    if (idleAlert) idleAlert.classList.add("hidden");
    if (preBanner) preBanner.classList.remove("hidden");
    const preNum = document.getElementById("te-prehold-num");
    if (preNum) preNum.textContent = Math.ceil(tePreHoldRemaining);
  } else if (tePhase === "holding") {
    if (phaseBadge) {
      phaseBadge.textContent = "🔒 DEEP HOLD PHASE";
      phaseBadge.style.borderColor = "var(--amber-warning)";
      phaseBadge.style.color = "var(--amber-warning)";
    }
    if (cadenceBox) cadenceBox.classList.add("hidden");
    if (holdBox) holdBox.classList.remove("hidden");
    if (delayBox) delayBox.classList.add("hidden");
    if (idleAlert) idleAlert.classList.add("hidden");
    if (preBanner) preBanner.classList.add("hidden");
    const holdTimer = document.getElementById("te-hold-timer");
    if (holdTimer) holdTimer.textContent = Math.max(0, teHoldRemaining).toFixed(1);
    if (phaseTimer) phaseTimer.textContent = `HOLD: ${Math.max(0, teHoldRemaining).toFixed(1)}s`;
  } else if (tePhase === "resting") {
    if (phaseBadge) {
      phaseBadge.textContent = "RESTING";
      phaseBadge.style.borderColor = "var(--text-secondary)";
      phaseBadge.style.color = "var(--text-secondary)";
    }
    if (cadenceBox) cadenceBox.classList.add("hidden");
    if (holdBox) holdBox.classList.remove("hidden");
    const holdTimer = document.getElementById("te-hold-timer");
    if (holdTimer) holdTimer.textContent = `REST: ${Math.max(0, teRestRemaining).toFixed(1)}s`;
    if (phaseTimer) phaseTimer.textContent = `REST: ${Math.max(0, teRestRemaining).toFixed(1)}s`;
    if (delayBox) delayBox.classList.add("hidden");
    if (idleAlert) idleAlert.classList.add("hidden");
    if (preBanner) preBanner.classList.add("hidden");
    setUnifiedGameState("can-release", `STAGE ${teCurrentStage - 1} CLEARED! RESTING...`, `Breathe! Stage ${teCurrentStage} accelerates to ${curBpm} BPM!`);
  } else if (tePhase === "rest_warning") {
    if (idleAlert) idleAlert.classList.remove("hidden");
    if (preBanner) preBanner.classList.add("hidden");
    const idleNum = document.getElementById("te-idle-num");
    if (idleNum) idleNum.textContent = Math.ceil(teRestWarningRemaining);
    setUnifiedGameState("stalling", `⚠️ INCOMING STAGE ${teCurrentStage} (${curBpm} BPM)!`, "Get ready to tap!");
  } else if (tePhase === "rest_expired") {
    if (idleAlert) idleAlert.classList.remove("hidden");
    if (preBanner) preBanner.classList.add("hidden");
    setUnifiedGameState("punish", `⚠️ REST EXPIRED! TAP TO START STAGE ${teCurrentStage}!`, "Feedback continues until pacing resumes.");
  } else if (tePhase === "won") {
    if (phaseBadge) {
      phaseBadge.textContent = "🏆 GAUNTLET CONQUERED";
      phaseBadge.style.borderColor = "var(--emerald-active)";
      phaseBadge.style.color = "var(--emerald-active)";
    }
    if (cadenceBox) cadenceBox.classList.add("hidden");
    if (holdBox) holdBox.classList.remove("hidden");
    const holdTimer = document.getElementById("te-hold-timer");
    if (holdTimer) holdTimer.textContent = "VICTORY";
    if (phaseTimer) phaseTimer.textContent = "DONE";
    if (delayBox) delayBox.classList.add("hidden");
    if (idleAlert) idleAlert.classList.add("hidden");
    if (preBanner) preBanner.classList.add("hidden");
    setUnifiedGameState("can-release", "🏆 GAUNTLET CONQUERED!", `All ${teTotalStages} stages beaten across fast tempo and final holds!`);
  }
}

function handleTempoEscalationTap() {
  if (tePhase === "won") return;

  if (tePhase === "ready" || tePhase === "resting" || tePhase === "rest_warning" || tePhase === "rest_expired") {
    startTempoEscalationPacingPhase();
    teActualBeats++;
    playTone(850, 30);
    return;
  }

  if (tePhase === "pacing") {
    teActualBeats++;
    teTapTimestamps.push(Date.now());
    playTone(850, 30);
  }
}

function handleTempoEscalationLogic(isDown) {
  if (tePhase === "won") return;

  // 3s grace countdown before the hold: going down early is allowed, no punishment either way
  if (tePhase === "prehold") {
    const preTitle = document.querySelector("#te-prehold-banner .prehold-title");
    if (isDown) {
      if (preTitle) preTitle.textContent = "✅ LOCKED IN! STAY DOWN...";
      setUnifiedGameState("holding", "LOCKED IN EARLY • STAY DOWN", "Hold timer starts when the countdown ends.");
      playTone(600, 60);
    } else {
      if (preTitle) preTitle.textContent = "🔒 PREPARE FOR FINAL HOLD!";
      setUnifiedGameState("must-hold", "MOVE TO TARGET POSITION!", `Hold starts in ${Math.ceil(tePreHoldRemaining)}s.`);
    }
    return;
  }

  if (tePhase === "holding") {
    if (isDown) {
      stopPunishLoop();
      playTone(600, 70);
      setUnifiedGameState("holding", `STAGE ${teCurrentStage}: DEEP HOLD HELD!`, "Hold deep unbroken contact until stage completes!");
    } else {
      // Released during hold phase -> persistent shock until re-engaged!
      setUnifiedGameState("punish", `⚠️ RELEASED AT TARGET! FEEDBACK ACTIVE!`, "Return to the target position to finish the stage.");
      startPunishLoop(getTeStageIntensity(teCurrentStage));
    }
    return;
  }

  if (isDown) {
    if (isRepStrokeArmed) {
      handleTempoEscalationTap();
      isRepStrokeArmed = false;
    }
  } else {
    if (config.inputSource !== "mediapipe") {
      isRepStrokeArmed = true;
    }
  }
}

function startTempoEscalationPacingPhase() {
  stopTempoEscalationGame();
  tePhase = "pacing";
  tePhaseRemaining = tePacingDurationSec;
  teElapsedPacingSec = 0;
  teActualBeats = 0;
  teExpectedBeats = 0;
  teDebt = 0;
  teTapTimestamps = [Date.now()];
  teDelayRemaining = 2.0;
  teIsPacingPunishing = false;
  updateTempoEscalationUI();

  const curBpm = getTeStageBpm(teCurrentStage);
  const curIntensity = getTeStageIntensity(teCurrentStage);

  // Authoritative Down-Beat Pacer synced to current stage BPM
  startBpmPacer(curBpm, "te-pacer-cue", "te-arena", false);
  teMetronomeTicker = bpmPacerTicker;

  // Main Pacing Engine Ticker
  teTicker = setInterval(() => {
    if (tePhase !== "pacing") return;

    const now = Date.now();
    teTapTimestamps = teTapTimestamps.filter(t => now - t <= 3500);

    // Live Cadence
    let liveBpm = 0;
    if (teTapTimestamps.length >= 2) {
      const duration = (teTapTimestamps[teTapTimestamps.length - 1] - teTapTimestamps[0]) / 1000;
      const count = teTapTimestamps.length - 1;
      if (duration > 0) liveBpm = Math.round((count / duration) * 60);
    }
    const liveEl = document.getElementById("te-live-bpm");
    if (liveEl) liveEl.textContent = liveBpm > 0 ? liveBpm : "…";

    // Expected Beats & Debt
    teElapsedPacingSec += 0.1;
    teExpectedBeats = Math.floor((teElapsedPacingSec * curBpm) / 60);
    teDebt = Math.max(0, teExpectedBeats - teActualBeats);

    const inFirstBeatWindow = teTapTimestamps.length === 1 &&
      (now - teTapTimestamps[0]) <= ((60000 / curBpm) * 1.25);
    const isPaceCompliant = inFirstBeatWindow || liveBpm >= (curBpm * 0.85);
    const delayBox = document.getElementById("te-delay-box");
    const delayNum = document.getElementById("te-delay-num");
    const delayFill = document.getElementById("te-delay-fill");

    if (isPaceCompliant) {
      teIsPacingPunishing = false;
      stopPunishLoop();
      teDelayRemaining = 2.0;
      if (delayBox) delayBox.classList.add("hidden");

      if (teDebt > 0) {
        setUnifiedGameState("holding", `RECOVERING BEAT DEBT (${teDebt} BEHIND)`, `Speed up past ${curBpm} BPM to clear debt!`);
      } else {
        setUnifiedGameState("holding", `STAGE ${teCurrentStage}: EXCELLENT CADENCE`, `Keep pace until the final hold begins.`);
      }

      tePhaseRemaining = Math.max(0, tePhaseRemaining - 0.1);
      updateTempoEscalationUI();

      if (tePhaseRemaining <= 0) {
        // Transition to Finishing Hold Phase!
        transitionToTempoEscalationHold();
      }
    } else {
      if (delayBox) delayBox.classList.remove("hidden");
      setUnifiedGameState("stalling", teDebt > 0 ? `FASTER! DEBT: ${teDebt} BEATS` : `FASTER! TARGET ${curBpm} BPM!`);

      teDelayRemaining = Math.max(0, teDelayRemaining - 0.1);
      if (delayNum) delayNum.textContent = `${teDelayRemaining.toFixed(1)}s`;
      if (delayFill) delayFill.style.width = `${(teDelayRemaining / 2.0) * 100}%`;

      if (teDelayRemaining <= 0) {
        if (!teIsPacingPunishing) {
          teIsPacingPunishing = true;
          setUnifiedGameState("punish", "⚠️ FEEDBACK ACTIVE! PACE FASTER!");
          startPunishLoop(curIntensity);
        }
      }
      updateTempoEscalationUI();
    }
  }, 100);
}

function transitionToTempoEscalationHold() {
  if (teTicker) clearInterval(teTicker);
  if (teMetronomeTicker) clearInterval(teMetronomeTicker);
  stopBpmPacer();
  teTicker = null;
  teMetronomeTicker = null;
  stopPunishLoop();

  // Phase A: 3-second grace countdown to get into position
  tePhase = "prehold";
  tePreHoldRemaining = 3;
  teHoldRemaining = teHoldDurationSec;
  updateTempoEscalationUI();

  playTone(660, 200, "triangle");
  setUnifiedGameState(isPhysicalDown ? "holding" : "must-hold", "PACING COMPLETE! PREPARE TO HOLD!", `Hold starts in 3s; maintain contact for ${teHoldDurationSec}s.`);

  teTicker = setInterval(() => {
    if (tePhase !== "prehold") return;
    const before = Math.ceil(tePreHoldRemaining);
    tePreHoldRemaining = Math.max(0, tePreHoldRemaining - 0.1);
    const after = Math.ceil(tePreHoldRemaining);
    if (after !== before && after > 0) playTone(500, 60);
    updateTempoEscalationUI();

    if (tePreHoldRemaining <= 0) {
      clearInterval(teTicker);
      teTicker = null;
      startTempoEscalationHoldPhase();
    }
  }, 100);
}

// Phase B: the actual hold. Not at hilt when it starts -> punished until down.
function startTempoEscalationHoldPhase() {
  tePhase = "holding";
  teHoldRemaining = teHoldDurationSec;
  updateTempoEscalationUI();
  playTone(880, 150);

  const curIntensity = getTeStageIntensity(teCurrentStage);
  if (isPhysicalDown) {
    setUnifiedGameState("holding", `STAGE ${teCurrentStage}: DEEP HOLD HELD!`, "Hold deep unbroken contact until stage completes!");
  } else {
    setUnifiedGameState("punish", "🚨 MOVE TO TARGET POSITION NOW!", "Final hold required!");
    startPunishLoop(curIntensity);
  }

  teTicker = setInterval(() => {
    if (tePhase !== "holding") return;

    if (isPhysicalDown) {
      teHoldRemaining = Math.max(0, teHoldRemaining - 0.1);
      updateTempoEscalationUI();

      if (teHoldRemaining <= 0) {
        clearInterval(teTicker);
        teTicker = null;
        onTempoEscalationStageCleared();
      }
    }
  }, 100);
}

function onTempoEscalationStageCleared() {
  playTone(523, 120);
  setTimeout(() => playTone(659, 120), 120);
  setTimeout(() => playTone(880, 250), 240);

  if (teCurrentStage >= teTotalStages) {
    tePhase = "won";
    sendRewardOnce("tempoescalation");
    updateTempoEscalationUI();
  } else {
    teCurrentStage++;
    tePhase = "resting";
    teRestRemaining = teRestDurationSec;
    teRestWarningRemaining = 3;
    updateTempoEscalationUI();
    startTempoEscalationRestTicker();
  }
}

function startTempoEscalationRestTicker() {
  if (teTicker) clearInterval(teTicker);

  teTicker = setInterval(() => {
    if (tePhase === "resting") {
      teRestRemaining = Math.max(0, teRestRemaining - 0.1);
      updateTempoEscalationUI();

      if (teRestRemaining <= 0) {
        tePhase = "rest_warning";
        teRestWarningRemaining = 3;
        updateTempoEscalationUI();
      }
    } else if (tePhase === "rest_warning") {
      teRestWarningRemaining = Math.max(0, teRestWarningRemaining - 0.1);
      updateTempoEscalationUI();

      if (teRestWarningRemaining <= 0) {
        tePhase = "rest_expired";
        updateTempoEscalationUI();
        startPunishLoop(getTeStageIntensity(teCurrentStage));
      }
    }
  }, 100);
}

// ==========================================
// 11. FRONT CAMERA LIGHT METER (HOLD BY COVERING)
// ==========================================
let camStream = null;
let camRafId = null;
let isCamActive = false;

function initCameraSensor() {
  const toggleBtn = document.getElementById("btn-camera-toggle");
  toggleBtn.addEventListener("click", () => {
    if (isCamActive) stopCameraMeter();
    else startCameraMeter();
  });
}

async function startCameraMeter() {
  const video = document.getElementById("cam-video");
  const toggleBtn = document.getElementById("btn-camera-toggle");
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 64 }, height: { ideal: 64 } }
    });
    video.srcObject = camStream;
    await video.play();
    isCamActive = true;
    toggleBtn.textContent = "Stop Camera Light Meter";
    toggleBtn.classList.remove("btn-secondary");
    toggleBtn.classList.add("btn-primary");
    sampleCameraLoop();
  } catch (err) {
    alert("Camera access denied or unavailable: " + err.message);
  }
}

function stopCameraMeter() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  if (camRafId) cancelAnimationFrame(camRafId);
  isCamActive = false;
  const toggleBtn = document.getElementById("btn-camera-toggle");
  toggleBtn.textContent = "Start Camera Light Meter";
  toggleBtn.classList.add("btn-secondary");
  toggleBtn.classList.remove("btn-primary");
}

function sampleCameraLoop() {
  if (!isCamActive) return;
  const video = document.getElementById("cam-video");
  const canvas = document.getElementById("cam-canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  if (video.readyState >= 2) {
    ctx.drawImage(video, 0, 0, 16, 16);
    const frame = ctx.getImageData(0, 0, 16, 16);
    const data = frame.data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }
    const brightness = Math.round((sum / (16 * 16 * 255)) * 100);
    document.getElementById("cam-meter-val").textContent = brightness;
    document.getElementById("cam-meter-fill").style.width = `${brightness}%`;

    if (config.inputSource === "camera") {
      const isCovered = brightness <= config.camThreshold;
      handlePhysicalInputState(isCovered);
    }
  }

  camRafId = requestAnimationFrame(sampleCameraLoop);
}

// ==========================================
// 10.5 NATIVE AMBIENT LIGHT SENSOR (GENERIC SENSOR API)
// ==========================================
let ambientSensor = null;
let isAmbientSensorActive = false;

function checkAmbientLightSensorSupport() {
  const statusEl = document.getElementById("ambient-support-alert");
  if (!statusEl) return false;

  if (!("AmbientLightSensor" in window)) {
    statusEl.className = "support-status unsupported";
    statusEl.innerHTML = `⚠️ <b>AmbientLightSensor API not available</b> in this browser.<br>
      <span style="font-size:0.75rem; opacity:0.85;">
      • <b>Android Chrome:</b> Enable flag <code>chrome://flags/#enable-generic-sensor-extra-classes</code> and relaunch.<br>
      • <b>iPhone/Safari:</b> iOS does not support Generic Sensor API. Use <b>Front Camera Light Meter</b> instead.
      </span>`;
    return false;
  }

  statusEl.className = "support-status supported";
  statusEl.innerHTML = `✓ <b>Hardware Ambient Light Sensor API supported!</b>`;
  return true;
}

function initAmbientLightSensor() {
  checkAmbientLightSensorSupport();

  const toggleBtn = document.getElementById("btn-ambient-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (isAmbientSensorActive) stopAmbientLightSensor();
      else startAmbientLightSensor();
    });
  }

  const thresholdSlider = document.getElementById("cfg-lux-threshold");
  if (thresholdSlider) {
    thresholdSlider.value = config.luxThreshold;
    document.getElementById("cfg-lux-threshold-val").textContent = `${config.luxThreshold} lx`;
    thresholdSlider.addEventListener("input", (e) => {
      config.luxThreshold = parseInt(e.target.value, 10);
      document.getElementById("cfg-lux-threshold-val").textContent = `${config.luxThreshold} lx`;
      localStorage.setItem("os_lux_threshold", config.luxThreshold);
    });
  }
}

async function startAmbientLightSensor() {
  if (!("AmbientLightSensor" in window)) {
    checkAmbientLightSensorSupport();
    return;
  }

  const toggleBtn = document.getElementById("btn-ambient-toggle");
  const statusEl = document.getElementById("ambient-support-alert");

  try {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const perm = await navigator.permissions.query({ name: "ambient-light-sensor" });
        if (perm.state === "denied") {
          if (statusEl) {
            statusEl.className = "support-status unsupported";
            statusEl.innerHTML = `⚠️ Permission to access ambient light sensor was denied.`;
          }
          return;
        }
      } catch (e) {}
    }

    stopAmbientLightSensor();

    ambientSensor = new AmbientLightSensor({ frequency: 20 });

    ambientSensor.addEventListener("reading", () => {
      const lux = Math.round(ambientSensor.illuminance);
      const meterVal = document.getElementById("lux-meter-val");
      const meterFill = document.getElementById("lux-meter-fill");

      if (meterVal) meterVal.textContent = lux;
      if (meterFill) {
        const pct = Math.min(100, Math.max(0, (lux / 100) * 100));
        meterFill.style.width = `${pct}%`;
      }

      if (config.inputSource === "ambient-light") {
        const isCovered = lux <= config.luxThreshold;
        handlePhysicalInputState(isCovered);
      }
    });

    ambientSensor.addEventListener("error", (event) => {
      console.warn("AmbientLightSensor error:", event.error);
      if (statusEl) {
        statusEl.className = "support-status unsupported";
        statusEl.innerHTML = `⚠️ Sensor Error: ${event.error ? event.error.name : "Unavailable"}`;
      }
      stopAmbientLightSensor();
    });

    ambientSensor.start();
    isAmbientSensorActive = true;

    if (toggleBtn) {
      toggleBtn.textContent = "Stop Ambient Light Sensor";
      toggleBtn.classList.remove("btn-secondary");
      toggleBtn.classList.add("btn-primary");
    }
    if (statusEl) {
      statusEl.className = "support-status supported";
      statusEl.innerHTML = `✓ <b>Hardware Light Sensor Active &amp; Reading!</b>`;
    }
  } catch (err) {
    console.error("Failed to start AmbientLightSensor:", err);
    if (statusEl) {
      statusEl.className = "support-status unsupported";
      statusEl.innerHTML = `⚠️ Could not initialize: ${err.message}`;
    }
  }
}

function stopAmbientLightSensor() {
  if (ambientSensor) {
    try { ambientSensor.stop(); } catch (e) {}
    ambientSensor = null;
  }
  isAmbientSensorActive = false;
  const toggleBtn = document.getElementById("btn-ambient-toggle");
  if (toggleBtn) {
    toggleBtn.textContent = "Start Ambient Light Sensor";
    toggleBtn.classList.add("btn-secondary");
    toggleBtn.classList.remove("btn-primary");
  }
}

// ==========================================
// 10.8 AI FACE & CHIN DEPTH METER (MEDIAPIPE FACE MESH)
// ==========================================
let faceMeshInstance = null;
let isMediaPipeActive = false;
let isMediaPipeLoading = false;
let mediaPipeStream = null;
let mediaPipeRaf = null;
let lastEstimatedDistanceCm = 999;
let lastLeadX = 0.5;
let lastLeadY = 0.5;
let isMediaPipeSending = false;
let mpHistoryX = [];
let mpHistoryY = [];
let mpHistoryChinX = [];
let mpHistoryChinY = [];
let mpHistoryAperture = [];
let mpSpikeCount = 0;
let lastMouthAperturePct = 0;
let lastBridgeRGB = null;
let mpCalibratedBridgeRGB = null;
let isObjectInMouth = true;
let mpMouthOutFrames = 0;
let mpSessionHadMouthContact = false;
let mpMouthDropPunishing = false;

function samplePatchRGB(imgData, w, h, cx, cy, halfSize = 6) {
  if (!imgData) return null;
  const d = imgData.data;
  const x0 = Math.max(0, Math.min(w - 1, Math.round(cx - halfSize)));
  const x1 = Math.max(0, Math.min(w - 1, Math.round(cx + halfSize)));
  const y0 = Math.max(0, Math.min(h - 1, Math.round(cy - halfSize)));
  const y1 = Math.max(0, Math.min(h - 1, Math.round(cy + halfSize)));
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x0; x <= x1; x += 2) {
      const idx = (y * w + x) * 4;
      r += d[idx];
      g += d[idx + 1];
      b += d[idx + 2];
      count++;
    }
  }
  return count > 0 ? [r / count, g / count, b / count] : null;
}

function rgbDist(a, b) {
  if (!a || !b) return 999;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function evaluateMouthObjectLock(ctx, rawImgData, w, h, landmarks) {
  const upperLip = landmarks[13];
  const lowerLip = landmarks[14];
  const outerUpper = landmarks[0];
  const outerLower = landmarks[17];
  const leftMouth = landmarks[61];
  const rightMouth = landmarks[291];
  const chin = landmarks[152];
  const nose = landmarks[1];
  const forehead = landmarks[10];

  if (!chin || !nose || !forehead) return true;

  const faceScale = Math.max(0.05, Math.hypot(chin.x - forehead.x, chin.y - forehead.y));
  const innerGap = (upperLip && lowerLip)
    ? Math.hypot(lowerLip.x - upperLip.x, lowerLip.y - upperLip.y) / faceScale
    : 0;
  const outerGap = (outerUpper && outerLower)
    ? Math.hypot(outerLower.x - outerUpper.x, outerLower.y - outerUpper.y) / faceScale
    : 0;
  const jawDrop = Math.max(0, (Math.hypot(chin.x - nose.x, chin.y - nose.y) / faceScale) - 0.34);

  const rawAperturePct = Math.min(99, Math.max(0, Math.round(innerGap * 220 + outerGap * 110 + jawDrop * 165)));
  const aperturePct = medianOf3(mpHistoryAperture, rawAperturePct);
  lastMouthAperturePct = aperturePct;

  // Determine pixel coordinates just in front of the lips (where the object bridges into the mouth)
  const lipCenterX = ((upperLip ? upperLip.x : nose.x) + (lowerLip ? lowerLip.x : chin.x)) * 0.5 * w;
  const lipCenterY = ((upperLip ? upperLip.y : nose.y) + (lowerLip ? lowerLip.y : chin.y)) * 0.5 * h;
  let bridgeX = lipCenterX;
  let bridgeY = lipCenterY;
  let bgX = 12;
  let bgY = 12;

  if (config.mpMode === "side") {
    const dir = config.mpSideDir === "ltr" ? 1 : -1;
    bridgeX = Math.max(8, Math.min(w - 8, lipCenterX + dir * 16));
    bridgeY = Math.max(8, Math.min(h - 8, lipCenterY + 2));
    bgX = dir > 0 ? 12 : (w - 12);
    bgY = 12;
  } else if (config.mpMode === "top") {
    const dir = config.mpTopDir === "ttb" ? 1 : -1;
    bridgeX = Math.max(8, Math.min(w - 8, lipCenterX));
    bridgeY = Math.max(8, Math.min(h - 8, lipCenterY + dir * 15));
    bgX = 12;
    bgY = dir > 0 ? 12 : (h - 12);
  } else {
    // Front mode: sample right below the lower lip / chin bridge
    const mouthMidX = (leftMouth && rightMouth) ? ((leftMouth.x + rightMouth.x) * 0.5 * w) : lipCenterX;
    bridgeX = Math.max(8, Math.min(w - 8, mouthMidX));
    bridgeY = Math.max(8, Math.min(h - 8, ((lowerLip ? lowerLip.y : chin.y) * 0.65 + chin.y * 0.35) * h));
    bgX = 12;
    bgY = 12;
  }

  const bridgeRGB = samplePatchRGB(rawImgData, w, h, bridgeX, bridgeY, 6);
  const bgRGB = samplePatchRGB(rawImgData, w, h, bgX, bgY, 6);
  lastBridgeRGB = bridgeRGB;

  const bgDiff = rgbDist(bridgeRGB, bgRGB);
  const calibDiff = mpCalibratedBridgeRGB ? rgbDist(bridgeRGB, mpCalibratedBridgeRGB) : 0;

  // Empty-air gap in front of the lips: bridge patch matches empty background corner and diverges from calibrated object
  const hasEmptyAirGap = (config.mpMode !== "front") && (bgDiff < 16) && (!mpCalibratedBridgeRGB || calibDiff > 32);
  const hasCalibMismatch = mpCalibratedBridgeRGB && (calibDiff > 78) && (bgDiff < 26);

  const apertureOk = aperturePct >= config.mpMouthSens;
  const rawInMouth = apertureOk && !hasEmptyAirGap && !hasCalibMismatch;

  if (rawInMouth) {
    mpMouthOutFrames = 0;
    isObjectInMouth = true;
  } else {
    mpMouthOutFrames++;
    if (mpMouthOutFrames >= 4) {
      isObjectInMouth = false;
    }
  }

  // Draw Mouth Bridge indicator box on canvas when Mouth Lock is active
  if (config.mpMouthLock === "on") {
    ctx.save();
    ctx.strokeStyle = isObjectInMouth ? "#10b981" : "#ff2a5f";
    ctx.lineWidth = 2;
    ctx.strokeRect(bridgeX - 8, bridgeY - 8, 16, 16);
    ctx.fillStyle = isObjectInMouth ? "#10b981" : "#ff2a5f";
    ctx.font = "bold 8px sans-serif";
    ctx.fillText(
      isObjectInMouth ? `MOUTH OK (${aperturePct}%)` : "LEFT MOUTH!",
      Math.max(4, Math.min(w - 78, bridgeX - 28)),
      Math.max(10, bridgeY - 11)
    );
    ctx.restore();
  }

  return isObjectInMouth;
}

function medianOf3(arr, nextVal) {
  arr.push(nextVal);
  if (arr.length > 3) arr.shift();
  if (arr.length < 3) return nextVal;
  const sorted = [arr[0], arr[1], arr[2]].sort((a, b) => a - b);
  return sorted[1];
}

function loadMediaPipeScript() {
  if (typeof FaceMesh !== "undefined" || (typeof window !== "undefined" && window.FaceMesh)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js";
    s.crossOrigin = "anonymous";
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error("Failed to load MediaPipe FaceMesh from CDN"));
    document.head.appendChild(s);
  });
}

function updateMediaPipeModeUI(mode) {
  config.mpMode = mode;
  localStorage.setItem("os_mp_mode", mode);

  const panelSide = document.getElementById("mp-settings-side");
  const panelTop = document.getElementById("mp-settings-top");
  const panelFront = document.getElementById("mp-settings-front");
  const calBtn = document.getElementById("btn-mp-calibrate");
  const calRetractBtn = document.getElementById("btn-mp-calibrate-retract");

  if (panelSide) panelSide.classList.toggle("hidden", mode !== "side");
  if (panelTop) panelTop.classList.toggle("hidden", mode !== "top");
  if (panelFront) panelFront.classList.toggle("hidden", mode !== "front");

  if (calBtn) {
    if (mode === "side") calBtn.textContent = "🎯 Set Target Line (IN)";
    else if (mode === "top") calBtn.textContent = "🎯 Set Target Line (IN)";
    else calBtn.textContent = "🎯 Set Target Distance (IN)";
  }
  if (calRetractBtn) {
    if (mode === "side") calRetractBtn.textContent = "🎯 Set Retract Line (OUT)";
    else if (mode === "top") calRetractBtn.textContent = "🎯 Set Retract Line (OUT)";
    else calRetractBtn.textContent = "🎯 Set Retract Dist (OUT)";
  }
}

function initMediaPipeDepth() {
  const toggleBtn = document.getElementById("btn-mp-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (isMediaPipeActive) stopMediaPipeDepth();
      else startMediaPipeDepth();
    });
  }

  const calibrateBtn = document.getElementById("btn-mp-calibrate");
  if (calibrateBtn) {
    calibrateBtn.addEventListener("click", calibrateMediaPipeHilt);
  }

  const calibrateRetractBtn = document.getElementById("btn-mp-calibrate-retract");
  if (calibrateRetractBtn) {
    calibrateRetractBtn.addEventListener("click", calibrateMediaPipeRetract);
  }

  // Camera Mode Radio Buttons
  document.querySelectorAll("input[name='mp-mode']").forEach(r => {
    r.checked = (r.value === config.mpMode);
    r.addEventListener("change", (e) => updateMediaPipeModeUI(e.target.value));
  });
  updateMediaPipeModeUI(config.mpMode);

  // Direction Radios
  document.querySelectorAll("input[name='mp-side-dir']").forEach(r => {
    r.checked = (r.value === config.mpSideDir);
    r.addEventListener("change", (e) => {
      config.mpSideDir = e.target.value;
      localStorage.setItem("os_mp_side_dir", config.mpSideDir);
    });
  });

  document.querySelectorAll("input[name='mp-top-dir']").forEach(r => {
    r.checked = (r.value === config.mpTopDir);
    r.addEventListener("change", (e) => {
      config.mpTopDir = e.target.value;
      localStorage.setItem("os_mp_top_dir", config.mpTopDir);
    });
  });

  // Tripwire X Slider (Side View - Hilt)
  const tripwireXSlider = document.getElementById("cfg-mp-tripwire-x");
  if (tripwireXSlider) {
    tripwireXSlider.value = Math.round(config.mpTripwireX * 100);
    const valSpan = document.getElementById("cfg-mp-tripwire-x-val");
    if (valSpan) valSpan.textContent = `${Math.round(config.mpTripwireX * 100)}%`;

    tripwireXSlider.addEventListener("input", (e) => {
      config.mpTripwireX = parseInt(e.target.value, 10) / 100;
      if (valSpan) valSpan.textContent = `${e.target.value}%`;
      localStorage.setItem("os_mp_tripwire_x", config.mpTripwireX);
    });
  }

  // Retract X Slider (Side View - Retract)
  const retractXSlider = document.getElementById("cfg-mp-retract-x");
  if (retractXSlider) {
    retractXSlider.value = Math.round(config.mpRetractX * 100);
    const valSpan = document.getElementById("cfg-mp-retract-x-val");
    if (valSpan) valSpan.textContent = `${Math.round(config.mpRetractX * 100)}%`;

    retractXSlider.addEventListener("input", (e) => {
      config.mpRetractX = parseInt(e.target.value, 10) / 100;
      if (valSpan) valSpan.textContent = `${e.target.value}%`;
      localStorage.setItem("os_mp_retract_x", config.mpRetractX);
    });
  }

  // Tripwire Y Slider (Top Down View - Hilt)
  const tripwireYSlider = document.getElementById("cfg-mp-tripwire-y");
  if (tripwireYSlider) {
    tripwireYSlider.value = Math.round(config.mpTripwireY * 100);
    const valSpan = document.getElementById("cfg-mp-tripwire-y-val");
    if (valSpan) valSpan.textContent = `${Math.round(config.mpTripwireY * 100)}%`;

    tripwireYSlider.addEventListener("input", (e) => {
      config.mpTripwireY = parseInt(e.target.value, 10) / 100;
      if (valSpan) valSpan.textContent = `${e.target.value}%`;
      localStorage.setItem("os_mp_tripwire_y", config.mpTripwireY);
    });
  }

  // Retract Y Slider (Top Down View - Retract)
  const retractYSlider = document.getElementById("cfg-mp-retract-y");
  if (retractYSlider) {
    retractYSlider.value = Math.round(config.mpRetractY * 100);
    const valSpan = document.getElementById("cfg-mp-retract-y-val");
    if (valSpan) valSpan.textContent = `${Math.round(config.mpRetractY * 100)}%`;

    retractYSlider.addEventListener("input", (e) => {
      config.mpRetractY = parseInt(e.target.value, 10) / 100;
      if (valSpan) valSpan.textContent = `${e.target.value}%`;
      localStorage.setItem("os_mp_retract_y", config.mpRetractY);
    });
  }

  // Front Threshold Slider (Hilt)
  const thresholdSlider = document.getElementById("cfg-mp-threshold");
  if (thresholdSlider) {
    thresholdSlider.value = config.mpHiltThreshold;
    const valSpan = document.getElementById("cfg-mp-threshold-val");
    if (valSpan) valSpan.textContent = `${config.mpHiltThreshold.toFixed(1)} cm`;

    thresholdSlider.addEventListener("input", (e) => {
      config.mpHiltThreshold = parseFloat(e.target.value);
      if (valSpan) valSpan.textContent = `${config.mpHiltThreshold.toFixed(1)} cm`;
      localStorage.setItem("os_mp_hilt_threshold", config.mpHiltThreshold);
    });
  }

  // Front Retract Slider (Retract Distance)
  const retractDistSlider = document.getElementById("cfg-mp-retract-dist");
  if (retractDistSlider) {
    retractDistSlider.value = config.mpRetractDist;
    const valSpan = document.getElementById("cfg-mp-retract-dist-val");
    if (valSpan) valSpan.textContent = `${config.mpRetractDist.toFixed(1)} cm`;

    retractDistSlider.addEventListener("input", (e) => {
      config.mpRetractDist = parseFloat(e.target.value);
      if (valSpan) valSpan.textContent = `${config.mpRetractDist.toFixed(1)} cm`;
      localStorage.setItem("os_mp_retract_dist", config.mpRetractDist);
    });
  }

  // Mouth Object Lock Radio Buttons & Sensitivity Slider
  const mouthControls = document.getElementById("mp-mouth-lock-controls");
  document.querySelectorAll("input[name='mp-mouth-lock']").forEach(r => {
    r.checked = (r.value === config.mpMouthLock);
    r.addEventListener("change", (e) => {
      config.mpMouthLock = e.target.value;
      localStorage.setItem("os_mp_mouth_lock", config.mpMouthLock);
      if (mouthControls) mouthControls.classList.toggle("hidden", config.mpMouthLock === "off");
    });
  });
  if (mouthControls) mouthControls.classList.toggle("hidden", config.mpMouthLock === "off");

  const mouthSensSlider = document.getElementById("cfg-mp-mouth-sens");
  if (mouthSensSlider) {
    mouthSensSlider.value = config.mpMouthSens;
    const valSpan = document.getElementById("cfg-mp-mouth-sens-val");
    if (valSpan) valSpan.textContent = `${config.mpMouthSens}%`;
    mouthSensSlider.addEventListener("input", (e) => {
      config.mpMouthSens = parseInt(e.target.value, 10);
      if (valSpan) valSpan.textContent = `${config.mpMouthSens}%`;
      localStorage.setItem("os_mp_mouth_sens", config.mpMouthSens);
    });
  }

  const calibrateMouthBtn = document.getElementById("btn-mp-calibrate-mouth");
  if (calibrateMouthBtn) {
    calibrateMouthBtn.addEventListener("click", () => calibrateMediaPipeMouthLock(true));
  }
}

async function startMediaPipeDepth() {
  const toggleBtn = document.getElementById("btn-mp-toggle");
  const statusEl = document.getElementById("mp-support-alert");

  if (statusEl) {
    statusEl.className = "support-status";
    statusEl.innerHTML = "Initializing camera &amp; MediaPipe FaceMesh...";
  }

  try {
    if (!faceMeshInstance) {
      await loadMediaPipeScript();
      const FaceMeshClass = (typeof window !== "undefined" && window.FaceMesh) ? window.FaceMesh : (typeof FaceMesh !== "undefined" ? FaceMesh : null);
      if (!FaceMeshClass) {
        throw new Error("FaceMesh engine unavailable");
      }
      faceMeshInstance = new FaceMeshClass({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
      });
      faceMeshInstance.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.6
      });
      faceMeshInstance.onResults(onMediaPipeResults);
    }

    const video = document.getElementById("mp-video");
    if (!mediaPipeStream) {
      mediaPipeStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
      });
      video.srcObject = mediaPipeStream;
      await video.play();
    }

    isMediaPipeActive = true;
    if (toggleBtn) {
      toggleBtn.textContent = "Stop Face Tracking";
      toggleBtn.classList.remove("btn-secondary");
      toggleBtn.classList.add("btn-primary");
    }
    if (statusEl) {
      statusEl.className = "support-status supported";
      statusEl.innerHTML = "✓ <b>AI FaceMesh Active &amp; Tracking!</b>";
    }

    processMediaPipeFrame();
  } catch (err) {
    console.error("Failed to start MediaPipe FaceMesh:", err);
    if (statusEl) {
      statusEl.className = "support-status unsupported";
      statusEl.innerHTML = `⚠️ MediaPipe Error: ${err.message}`;
    }
  }
}

function stopMediaPipeDepth() {
  if (mediaPipeRaf) {
    cancelAnimationFrame(mediaPipeRaf);
    mediaPipeRaf = null;
  }
  if (mediaPipeStream) {
    mediaPipeStream.getTracks().forEach(t => t.stop());
    mediaPipeStream = null;
  }
  isMediaPipeActive = false;
  isMediaPipeSending = false;

  const toggleBtn = document.getElementById("btn-mp-toggle");
  if (toggleBtn) {
    toggleBtn.textContent = "Start Face Tracking";
    toggleBtn.classList.add("btn-secondary");
    toggleBtn.classList.remove("btn-primary");
  }
}

async function processMediaPipeFrame() {
  if (!isMediaPipeActive) return;

  const video = document.getElementById("mp-video");
  if (video && video.readyState >= 2 && faceMeshInstance && !isMediaPipeSending) {
    isMediaPipeSending = true;
    try {
      await faceMeshInstance.send({ image: video });
    } catch (e) {
      console.warn("FaceMesh send error:", e);
    } finally {
      isMediaPipeSending = false;
    }
  }

  mediaPipeRaf = requestAnimationFrame(processMediaPipeFrame);
}

function onMediaPipeResults(results) {
  const canvas = document.getElementById("mp-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  let rawFrameImgData = null;
  if (results.image) {
    ctx.drawImage(results.image, 0, 0, w, h);
    try {
      rawFrameImgData = ctx.getImageData(0, 0, w, h);
    } catch (_) {}
  }

  let isAtHilt = false;
  let isAtRetract = false;
  let metricDisplay = "…";
  let progressPct = 0;

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];
    evaluateMouthObjectLock(ctx, rawFrameImgData, w, h, landmarks);

    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const leftCheek = landmarks[234];
    const rightCheek = landmarks[454];
    const leftMouth = landmarks[61];
    const rightMouth = landmarks[291];
    const chin = landmarks[152];
    const nose = landmarks[1];
    const forehead = landmarks[10];

    // Identify forward lead coordinates across prominent profile points
    const pointsX = [chin.x, nose.x, leftMouth.x, rightMouth.x].filter(v => typeof v === "number");
    const pointsY = [chin.y, nose.y, leftMouth.y, rightMouth.y].filter(v => typeof v === "number");

    const rawLeadX_right = Math.max(...pointsX);
    const rawLeadX_left = Math.min(...pointsX);
    const rawLeadY_down = Math.max(...pointsY);
    const rawLeadY_up = Math.min(...pointsY);

    // Reject single-frame tracking teleports (>16% of frame in 1 tick)
    const rawTargetX = config.mpMode === "side"
      ? (config.mpSideDir === "ltr" ? rawLeadX_right : rawLeadX_left)
      : chin.x;
    const rawTargetY = config.mpMode === "top"
      ? (config.mpTopDir === "ttb" ? rawLeadY_down : rawLeadY_up)
      : chin.y;

    const jumpDist = mpHistoryX.length > 0
      ? Math.hypot(rawTargetX - lastLeadX, rawTargetY - lastLeadY)
      : 0;

    let filteredLeadX = rawTargetX;
    let filteredLeadY = rawTargetY;
    let filteredChinX = chin.x;
    let filteredChinY = chin.y;

    if (jumpDist > 0.16 && mpSpikeCount < 1) {
      // Ignore a 1-frame tracking spike; hold previous stabilized coordinates
      mpSpikeCount++;
      filteredLeadX = lastLeadX;
      filteredLeadY = lastLeadY;
      filteredChinX = mpHistoryChinX.length ? mpHistoryChinX[mpHistoryChinX.length - 1] : chin.x;
      filteredChinY = mpHistoryChinY.length ? mpHistoryChinY[mpHistoryChinY.length - 1] : chin.y;
    } else {
      mpSpikeCount = 0;
      filteredLeadX = medianOf3(mpHistoryX, rawTargetX);
      filteredLeadY = medianOf3(mpHistoryY, rawTargetY);
      filteredChinX = medianOf3(mpHistoryChinX, chin.x);
      filteredChinY = medianOf3(mpHistoryChinY, chin.y);
    }

    const leadX_right = filteredLeadX;
    const leadX_left = filteredLeadX;
    const leadY_down = filteredLeadY;
    const leadY_up = filteredLeadY;

    if (config.mpMode === "side") {
      // ==========================================
      // MODE 1: SIDE VIEW (PROFILE TRIPWIRE)
      // ==========================================
      const isLtr = (config.mpSideDir === "ltr");
      const currentLeadX = isLtr ? leadX_right : leadX_left;
      lastLeadX = currentLeadX;
      lastLeadY = filteredChinY;

      const tripwireX = config.mpTripwireX;
      const retractX = config.mpRetractX;
      isAtHilt = isLtr ? (currentLeadX >= tripwireX) : (currentLeadX <= tripwireX);
      isAtRetract = isLtr ? (currentLeadX <= retractX) : (currentLeadX >= retractX);

      // 1. Draw Retract Barrier (Cyan dashed line)
      ctx.lineWidth = 2;
      if (ctx.setLineDash) ctx.setLineDash([5, 4]);
      ctx.strokeStyle = isAtRetract ? "#06b6d4" : "rgba(6, 182, 212, 0.45)";
      ctx.beginPath();
      ctx.moveTo(retractX * w, 0);
      ctx.lineTo(retractX * w, h);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);

      // Retract Label
      ctx.fillStyle = isAtRetract ? "#06b6d4" : "rgba(6, 182, 212, 0.75)";
      ctx.font = "bold 9px sans-serif";
      ctx.fillText(`RETRACT ${Math.round(retractX * 100)}%`, retractX * w + (isLtr ? 4 : -68), 26);

      // 2. Draw Hilt Barrier (Green / Pink solid line)
      ctx.lineWidth = 3;
      ctx.strokeStyle = isAtHilt ? "#10b981" : "#ff2a5f";
      ctx.beginPath();
      ctx.moveTo(tripwireX * w, 0);
      ctx.lineTo(tripwireX * w, h);
      ctx.stroke();

      // Hilt Label
      ctx.fillStyle = isAtHilt ? "#10b981" : "#ff2a5f";
      ctx.font = "bold 9px sans-serif";
      ctx.fillText(`TARGET ${Math.round(tripwireX * 100)}%`, tripwireX * w + (isLtr ? -65 : 6), 14);

      // Draw tracked lead point
      ctx.fillStyle = isAtHilt ? "#10b981" : (isAtRetract ? "#06b6d4" : "#ff2a5f");
      ctx.beginPath();
      ctx.arc(currentLeadX * w, filteredChinY * h, 6, 0, 2 * Math.PI);
      ctx.fill();

      // Draw profile points (only if not a rejected spike frame)
      if (mpSpikeCount === 0) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        for (const pt of [nose, chin, leftMouth, rightMouth]) {
          if (pt) {
            ctx.beginPath();
            ctx.arc(pt.x * w, pt.y * h, 3, 0, 2 * Math.PI);
            ctx.fill();
          }
        }
      }

      metricDisplay = `${Math.round(currentLeadX * 100)}% | Target:${Math.round(tripwireX * 100)}% | Ret:${Math.round(retractX * 100)}%`;
      progressPct = isLtr ? Math.min(100, Math.max(0, (currentLeadX / tripwireX) * 100)) : Math.min(100, Math.max(0, ((1 - currentLeadX) / (1 - tripwireX)) * 100));

    } else if (config.mpMode === "top") {
      // ==========================================
      // MODE 2: TOP-DOWN VIEW (VERTICAL TRIPWIRE)
      // ==========================================
      const isTtb = (config.mpTopDir === "ttb");
      const currentLeadY = isTtb ? leadY_down : leadY_up;
      lastLeadY = currentLeadY;
      lastLeadX = filteredChinX;

      const tripwireY = config.mpTripwireY;
      const retractY = config.mpRetractY;
      isAtHilt = isTtb ? (currentLeadY >= tripwireY) : (currentLeadY <= tripwireY);
      isAtRetract = isTtb ? (currentLeadY <= retractY) : (currentLeadY >= retractY);

      // 1. Draw Retract Barrier (Cyan dashed line)
      ctx.lineWidth = 2;
      if (ctx.setLineDash) ctx.setLineDash([5, 4]);
      ctx.strokeStyle = isAtRetract ? "#06b6d4" : "rgba(6, 182, 212, 0.45)";
      ctx.beginPath();
      ctx.moveTo(0, retractY * h);
      ctx.lineTo(w, retractY * h);
      ctx.stroke();
      if (ctx.setLineDash) ctx.setLineDash([]);

      // Retract Label
      ctx.fillStyle = isAtRetract ? "#06b6d4" : "rgba(6, 182, 212, 0.75)";
      ctx.font = "bold 9px sans-serif";
      ctx.fillText(`RETRACT ${Math.round(retractY * 100)}%`, 8, retractY * h + (isTtb ? -6 : 14));

      // 2. Draw Hilt Barrier (Green / Pink solid line)
      ctx.lineWidth = 3;
      ctx.strokeStyle = isAtHilt ? "#10b981" : "#ff2a5f";
      ctx.beginPath();
      ctx.moveTo(0, tripwireY * h);
      ctx.lineTo(w, tripwireY * h);
      ctx.stroke();

      // Hilt Label
      ctx.fillStyle = isAtHilt ? "#10b981" : "#ff2a5f";
      ctx.font = "bold 9px sans-serif";
      ctx.fillText(`TARGET ${Math.round(tripwireY * 100)}%`, 8, tripwireY * h + (isTtb ? -6 : 14));

      // Draw tracked lead point
      ctx.fillStyle = isAtHilt ? "#10b981" : (isAtRetract ? "#06b6d4" : "#ff2a5f");
      ctx.beginPath();
      ctx.arc(filteredChinX * w, currentLeadY * h, 6, 0, 2 * Math.PI);
      ctx.fill();

      metricDisplay = `${Math.round(currentLeadY * 100)}% | Target:${Math.round(tripwireY * 100)}% | Ret:${Math.round(retractY * 100)}%`;
      progressPct = isTtb ? Math.min(100, Math.max(0, (currentLeadY / tripwireY) * 100)) : Math.min(100, Math.max(0, ((1 - currentLeadY) / (1 - tripwireY)) * 100));

    } else {
      // ==========================================
      // MODE 3: FRONT VIEW (OPTICAL DISTANCE TO LENS)
      // ==========================================
      const eyeNorm = (leftEye && rightEye) ? Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) : 0;
      const cheekNorm = (leftCheek && rightCheek) ? Math.hypot(rightCheek.x - leftCheek.x, rightCheek.y - leftCheek.y) : 0;
      const mouthNorm = (leftMouth && rightMouth) ? Math.hypot(rightMouth.x - leftMouth.x, rightMouth.y - leftMouth.y) : 0;
      const noseChinNorm = (chin && nose) ? Math.hypot(chin.x - nose.x, chin.y - nose.y) : 0;

      const distFromEyes = eyeNorm > 0.05 ? 6.8 / eyeNorm : 999;
      const distFromCheeks = cheekNorm > 0.08 ? 9.6 / cheekNorm : 999;
      const distFromMouth = mouthNorm > 0.05 ? 3.6 / mouthNorm : 999;
      const distFromNoseChin = noseChinNorm > 0.05 ? 4.6 / noseChinNorm : 999;

      const rawDist = Math.min(distFromEyes, distFromCheeks, distFromMouth, distFromNoseChin);
      const distanceCm = lastEstimatedDistanceCm === 999 ? rawDist : (lastEstimatedDistanceCm * 0.65 + rawDist * 0.35);
      lastEstimatedDistanceCm = distanceCm;

      isAtHilt = (distanceCm <= config.mpHiltThreshold);
      isAtRetract = (distanceCm >= config.mpRetractDist);
      metricDisplay = distanceCm >= 99 ? ">30 cm" : `${distanceCm.toFixed(1)} cm (H:${config.mpHiltThreshold.toFixed(1)}/R:${config.mpRetractDist.toFixed(1)})`;
      progressPct = Math.min(100, Math.max(0, (distanceCm / 20) * 100));

      // Draw face landmarks (use stabilized chin coordinates to avoid 1-frame jumps)
      const stableChin = { x: filteredChinX, y: filteredChinY };
      ctx.fillStyle = isAtHilt ? "#10b981" : (isAtRetract ? "#06b6d4" : "#ff2a5f");
      const keyPoints = mpSpikeCount > 0
        ? [stableChin]
        : [stableChin, nose, leftEye, rightEye, forehead, leftCheek, rightCheek, leftMouth, rightMouth];
      for (const pt of keyPoints) {
        if (pt) {
          ctx.beginPath();
          ctx.arc(pt.x * w, pt.y * h, 3.5, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      if (stableChin && nose && mpSpikeCount === 0) {
        ctx.strokeStyle = isAtHilt ? "rgba(16, 185, 129, 0.8)" : (isAtRetract ? "rgba(6, 182, 212, 0.8)" : "rgba(255, 42, 95, 0.8)");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(stableChin.x * w, stableChin.y * h);
        ctx.lineTo(nose.x * w, nose.y * h);
        ctx.stroke();
      }
    }

  } else {
    // If no face found in front mode, check darkness
    if (config.mpMode === "front") {
      try {
        const imgData = ctx.getImageData(0, 0, w, h);
        const d = imgData.data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 16) {
          sum += (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        }
        const avgBrightness = sum / ((w * h * 255) / 4);
        if (avgBrightness < 0.1) {
          isAtHilt = true;
          isAtRetract = false;
          metricDisplay = "0.5 cm";
          lastEstimatedDistanceCm = 0.5;
        } else {
          isAtHilt = false;
          isAtRetract = true;
          metricDisplay = "NO FACE";
          lastEstimatedDistanceCm = 999;
        }
      } catch (e) {
        isAtHilt = false;
        isAtRetract = false;
        metricDisplay = "NO FACE";
      }
    } else {
      isAtHilt = false;
      isAtRetract = false;
      metricDisplay = "NO FACE";
    }
  }

  ctx.restore();

  // Update UI Elements
  const container = document.querySelector(".mp-preview-container");
  const badge = document.getElementById("mp-indicator-badge");
  const distVal = document.getElementById("mp-distance-val");
  const lockStatus = document.getElementById("mp-lock-status");
  const distFill = document.getElementById("mp-distance-fill");

  if (container) {
    container.classList.toggle("at-hilt", isAtHilt);
    container.classList.toggle("out-depth", !isAtHilt);
  }

  if (badge) {
    if (isAtHilt) {
      badge.className = "mp-badge badge-hilt";
      badge.textContent = "LOCKED AT TARGET";
    } else if (isAtRetract) {
      badge.className = "mp-badge badge-retract";
      badge.textContent = "CLEARED (ARMED)";
    } else {
      badge.className = "mp-badge badge-far";
      badge.textContent = metricDisplay === "NO FACE" ? "NO FACE" : (isRepStrokeArmed ? "ARMED (DRIVE)" : "OUT OF DEPTH");
    }
  }

  if (distVal) {
    distVal.textContent = metricDisplay;
  }

  if (lockStatus) {
    if (isAtHilt) {
      lockStatus.textContent = "✓ TARGET REACHED";
      lockStatus.style.color = "var(--emerald-active)";
    } else if (isAtRetract) {
      lockStatus.textContent = "✓ RETRACT CLEARED (ARMED)";
      lockStatus.style.color = "var(--cyan-accent, #06b6d4)";
    } else {
      lockStatus.textContent = isRepStrokeArmed ? "READY: MOVE IN" : "MOVE BACK TO RESET";
      lockStatus.style.color = isRepStrokeArmed ? "var(--amber-warn, #f59e0b)" : "var(--red-punish)";
    }
  }

  if (distFill) {
    distFill.style.width = `${progressPct}%`;
  }

  // Update Mouth Lock UI & enforce mouth-lock rules
  const mouthValEl = document.getElementById("mp-mouth-val");
  const mouthStatusEl = document.getElementById("mp-mouth-status");
  const hasFace = metricDisplay !== "NO FACE";
  const mouthLockActive = config.mpMouthLock === "on";

  if (mouthValEl) {
    mouthValEl.textContent = hasFace
      ? `Aperture: ${lastMouthAperturePct}% (Min: ${config.mpMouthSens}%)`
      : "No face in view";
  }
  if (mouthStatusEl) {
    if (!hasFace) {
      mouthStatusEl.textContent = "NO FACE";
      mouthStatusEl.style.color = "var(--text-secondary)";
    } else if (isObjectInMouth) {
      mouthStatusEl.textContent = "✓ IN MOUTH";
      mouthStatusEl.style.color = "var(--emerald-active)";
    } else {
      mouthStatusEl.textContent = "⚠️ LEFT MOUTH!";
      mouthStatusEl.style.color = "var(--red-punish)";
    }
  }

  if (config.inputSource === "mediapipe") {
    if (mouthLockActive && hasFace && !isObjectInMouth) {
      // Object is not in the mouth: cannot count as holding at target
      isAtHilt = false;
      handlePhysicalInputState(false);

      // If an active game session had already engaged, punish if the object stays out of the mouth
      if (currentScreen.startsWith("game-") && mpSessionHadMouthContact && mpMouthOutFrames >= 8) {
        if (!mpMouthDropPunishing) {
          mpMouthDropPunishing = true;
          setUnifiedGameState(
            "punish",
            "🚨 OBJECT LEFT MOUTH!",
            "Put the object back in your mouth immediately to stop feedback!"
          );
          startPunishLoop();
        }
      }
      return;
    }

    if (hasFace && isObjectInMouth && mpMouthDropPunishing) {
      mpMouthDropPunishing = false;
      stopPunishLoop();
    }

    if (isAtHilt) {
      mpSessionHadMouthContact = true;
      handlePhysicalInputState(true);
    } else if (isAtRetract) {
      if (!isRepStrokeArmed) {
        isRepStrokeArmed = true;
        playTone(920, 25, "sine"); // Crisp acoustic feedback on reset!
      }
      handlePhysicalInputState(false);
    } else {
      // In between Hilt and Retract
      handlePhysicalInputState(false);
    }
  }
}

function calibrateMediaPipeMouthLock(showBanner = false) {
  const statusEl = document.getElementById("mp-support-alert");
  if (lastMouthAperturePct <= 0) {
    if (showBanner && statusEl) {
      statusEl.className = "support-status unsupported";
      statusEl.innerHTML = "⚠️ Keep your face visible in the camera with the object in your mouth to calibrate.";
    }
    return;
  }
  mpCalibratedBridgeRGB = lastBridgeRGB ? [...lastBridgeRGB] : null;
  const newSens = Math.max(10, Math.min(65, Math.round(lastMouthAperturePct * 0.65)));
  config.mpMouthSens = newSens;
  localStorage.setItem("os_mp_mouth_sens", config.mpMouthSens);
  const slider = document.getElementById("cfg-mp-mouth-sens");
  if (slider) slider.value = config.mpMouthSens;
  const valSpan = document.getElementById("cfg-mp-mouth-sens-val");
  if (valSpan) valSpan.textContent = `${config.mpMouthSens}%`;
  isObjectInMouth = true;
  mpMouthOutFrames = 0;

  if (showBanner && statusEl) {
    statusEl.className = "support-status supported";
    statusEl.innerHTML = `✓ <b>Mouth Lock Calibrated!</b> Aperture threshold set to ${config.mpMouthSens}% &amp; lip-bridge color locked.`;
  }
}

function calibrateMediaPipeHilt() {
  calibrateMediaPipeMouthLock(false);
  const statusEl = document.getElementById("mp-support-alert");

  if (config.mpMode === "side") {
    // Set tripwire X to current nose/chin position
    if (lastLeadX > 0.05 && lastLeadX < 0.95) {
      config.mpTripwireX = Math.round(lastLeadX * 100) / 100;
      const slider = document.getElementById("cfg-mp-tripwire-x");
      if (slider) slider.value = Math.round(config.mpTripwireX * 100);
      const valSpan = document.getElementById("cfg-mp-tripwire-x-val");
      if (valSpan) valSpan.textContent = `${Math.round(config.mpTripwireX * 100)}%`;
      localStorage.setItem("os_mp_tripwire_x", config.mpTripwireX);

      if (statusEl) {
        statusEl.className = "support-status supported";
        statusEl.innerHTML = `✓ <b>Side Tripwire Set!</b> Target line locked at ${Math.round(config.mpTripwireX * 100)}% of screen width.`;
      }
    } else {
      if (statusEl) {
        statusEl.className = "support-status unsupported";
        statusEl.innerHTML = "⚠️ Please ensure your face profile is visible in camera before setting target line.";
      }
    }
  } else if (config.mpMode === "top") {
    // Set tripwire Y to current nose/chin position
    if (lastLeadY > 0.05 && lastLeadY < 0.95) {
      config.mpTripwireY = Math.round(lastLeadY * 100) / 100;
      const slider = document.getElementById("cfg-mp-tripwire-y");
      if (slider) slider.value = Math.round(config.mpTripwireY * 100);
      const valSpan = document.getElementById("cfg-mp-tripwire-y-val");
      if (valSpan) valSpan.textContent = `${Math.round(config.mpTripwireY * 100)}%`;
      localStorage.setItem("os_mp_tripwire_y", config.mpTripwireY);

      if (statusEl) {
        statusEl.className = "support-status supported";
        statusEl.innerHTML = `✓ <b>Top Down Tripwire Set!</b> Target line locked at ${Math.round(config.mpTripwireY * 100)}% of screen height.`;
      }
    } else {
      if (statusEl) {
        statusEl.className = "support-status unsupported";
        statusEl.innerHTML = "⚠️ Please ensure your face is visible from above before setting target line.";
      }
    }
  } else {
    // Front mode: calibrate in cm
    if (lastEstimatedDistanceCm > 0 && lastEstimatedDistanceCm < 30) {
      const newThresh = Math.round((lastEstimatedDistanceCm + 1.2) * 2) / 2;
      config.mpHiltThreshold = Math.max(2.0, Math.min(15.0, newThresh));
      const slider = document.getElementById("cfg-mp-threshold");
      if (slider) slider.value = config.mpHiltThreshold;
      const valSpan = document.getElementById("cfg-mp-threshold-val");
      if (valSpan) valSpan.textContent = `${config.mpHiltThreshold.toFixed(1)} cm`;
      localStorage.setItem("os_mp_hilt_threshold", config.mpHiltThreshold);

      if (statusEl) {
        statusEl.className = "support-status supported";
        statusEl.innerHTML = `✓ <b>Calibrated!</b> Front target distance set to ${config.mpHiltThreshold.toFixed(1)} cm.`;
      }
    } else {
      if (statusEl) {
        statusEl.className = "support-status unsupported";
        statusEl.innerHTML = "⚠️ Please position face/chin in front of camera before calibrating.";
      }
    }
  }
}

function calibrateMediaPipeRetract() {
  calibrateMediaPipeMouthLock(false);
  const statusEl = document.getElementById("mp-support-alert");

  if (config.mpMode === "side") {
    if (lastLeadX > 0.05 && lastLeadX < 0.95) {
      config.mpRetractX = Math.round(lastLeadX * 100) / 100;
      const slider = document.getElementById("cfg-mp-retract-x");
      if (slider) slider.value = Math.round(config.mpRetractX * 100);
      const valSpan = document.getElementById("cfg-mp-retract-x-val");
      if (valSpan) valSpan.textContent = `${Math.round(config.mpRetractX * 100)}%`;
      localStorage.setItem("os_mp_retract_x", config.mpRetractX);

      if (statusEl) {
        statusEl.className = "support-status supported";
        statusEl.innerHTML = `✓ <b>Side Retract Line Set!</b> Retract line locked at ${Math.round(config.mpRetractX * 100)}% of screen width.`;
      }
    } else {
      if (statusEl) {
        statusEl.className = "support-status unsupported";
        statusEl.innerHTML = "⚠️ Please ensure your face profile is visible in camera before setting retract line.";
      }
    }
  } else if (config.mpMode === "top") {
    if (lastLeadY > 0.05 && lastLeadY < 0.95) {
      config.mpRetractY = Math.round(lastLeadY * 100) / 100;
      const slider = document.getElementById("cfg-mp-retract-y");
      if (slider) slider.value = Math.round(config.mpRetractY * 100);
      const valSpan = document.getElementById("cfg-mp-retract-y-val");
      if (valSpan) valSpan.textContent = `${Math.round(config.mpRetractY * 100)}%`;
      localStorage.setItem("os_mp_retract_y", config.mpRetractY);

      if (statusEl) {
        statusEl.className = "support-status supported";
        statusEl.innerHTML = `✓ <b>Top Down Retract Line Set!</b> Retract line locked at ${Math.round(config.mpRetractY * 100)}% of screen height.`;
      }
    } else {
      if (statusEl) {
        statusEl.className = "support-status unsupported";
        statusEl.innerHTML = "⚠️ Please ensure your face is visible from above before setting retract line.";
      }
    }
  } else {
    if (lastEstimatedDistanceCm > 0 && lastEstimatedDistanceCm < 40) {
      const newRetract = Math.round(lastEstimatedDistanceCm * 2) / 2;
      config.mpRetractDist = Math.max(8.0, Math.min(30.0, newRetract));
      const slider = document.getElementById("cfg-mp-retract-dist");
      if (slider) slider.value = config.mpRetractDist;
      const valSpan = document.getElementById("cfg-mp-retract-dist-val");
      if (valSpan) valSpan.textContent = `${config.mpRetractDist.toFixed(1)} cm`;
      localStorage.setItem("os_mp_retract_dist", config.mpRetractDist);

      if (statusEl) {
        statusEl.className = "support-status supported";
        statusEl.innerHTML = `✓ <b>Calibrated!</b> Retract clearance distance set to ${config.mpRetractDist.toFixed(1)} cm.`;
      }
    } else {
      if (statusEl) {
        statusEl.className = "support-status unsupported";
        statusEl.innerHTML = "⚠️ Please position face/chin in front of camera before calibrating.";
      }
    }
  }
}

// ==========================================
// 11. HARDWARE WEBSOCKET INPUT
// ==========================================
let wsClient = null;

function initWebSocketSensor() {
  const btn = document.getElementById("btn-ws-connect");
  btn.addEventListener("click", () => {
    connectWebSocket(document.getElementById("cfg-ws-url").value.trim());
  });
}

function connectWebSocket(url) {
  const statusSpan = document.getElementById("ws-status");
  statusSpan.textContent = "Connecting...";

  try {
    if (wsClient) wsClient.close();
    wsClient = new WebSocket(url);

    wsClient.onopen = () => {
      statusSpan.textContent = "Connected!";
      statusSpan.style.color = "var(--emerald-active)";
    };

    wsClient.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (config.inputSource === "websocket" && typeof msg.isDown !== "undefined") {
          handlePhysicalInputState(Boolean(msg.isDown));
        }
      } catch (e) {}
    };

    wsClient.onerror = () => {
      statusSpan.textContent = "Connection Error";
      statusSpan.style.color = "var(--red-punish)";
    };

    wsClient.onclose = () => {
      statusSpan.textContent = "Disconnected";
      statusSpan.style.color = "var(--text-secondary)";
    };
  } catch (err) {
    statusSpan.textContent = "Failed: " + err.message;
  }
}

// ==========================================
// 12. HOME PAGE SETTINGS
// ==========================================
function syncDefaultIntensityToSetups(intensity) {
  const clamped = Math.max(1, Math.min(99, parseInt(intensity, 10) || 20));
  ["setup-hc-intensity", "setup-hdl-intensity", "setup-dt-intensity", "setup-bpm-intensity", "setup-bh-intensity"].forEach(id => {
    const slider = document.getElementById(id);
    if (slider) {
      slider.value = String(clamped);
      slider.dispatchEvent(new Event("input"));
    }
  });
}

function updateOutputFields(mode) {
  const isWebhook = mode === "webhook";
  document.getElementById("output-openshock-fields").classList.toggle(
    "hidden", mode !== "openshock");
  document.getElementById("output-pishock-fields").classList.toggle(
    "hidden", mode !== "pishock");
  document.getElementById("output-webhook-fields").classList.toggle(
    "hidden", !isWebhook);
  document.getElementById("punishment-options").classList.toggle(
    "hidden", isWebhook);
  document.querySelectorAll(".hardware-only").forEach(el => {
    el.classList.toggle("hidden", isWebhook);
  });
}

function initSettingsPage() {
  const hub = document.getElementById("screen-hub");
  const sessionsTab = document.getElementById("tab-sessions");
  const prisonTab = document.getElementById("tab-prison");
  const settingsTab = document.getElementById("tab-settings");
  const setHubView = view => {
    hub.dataset.view = view;
    sessionsTab.setAttribute("aria-pressed", String(view === "sessions"));
    if (prisonTab) prisonTab.setAttribute("aria-pressed", String(view === "prison"));
    settingsTab.setAttribute("aria-pressed", String(view === "settings"));
    localStorage.setItem("os_hub_view", view);
  };
  const savedHubView = localStorage.getItem("os_hub_view");
  if (["sessions", "prison", "settings"].includes(savedHubView)) {
    setHubView(savedHubView);
  }

  const populateSettings = () => {
    document.getElementById("cfg-output-mode").value = config.outputMode;
    document.getElementById("cfg-webhook-url").value = config.webhookUrl;
    document.getElementById("cfg-webhook-token").value = config.webhookToken;
    document.getElementById("cfg-reward-webhook-url").value = config.rewardWebhookUrl;
    document.getElementById("cfg-reward-webhook-token").value = config.rewardWebhookToken;
    document.getElementById("cfg-pishock-username").value = config.piUsername;
    document.getElementById("cfg-pishock-key").value = config.piApiKey;
    document.getElementById("cfg-pishock-code").value = config.piShareCode;
    document.getElementById("cfg-token").value = config.token;
    document.getElementById("cfg-shocker-id").value = config.shockerId;
    document.getElementById("cfg-intensity").value = config.intensity;
    document.getElementById("cfg-duration").value = config.duration;
    document.getElementById("cfg-input-source").value = config.inputSource;
    const wsInput = document.getElementById("cfg-ws-url");
    if (wsInput) wsInput.value = config.wsUrl;

    const luxInput = document.getElementById("cfg-lux-threshold");
    if (luxInput) {
      luxInput.value = config.luxThreshold;
      document.getElementById("cfg-lux-threshold-val").textContent = `${config.luxThreshold} lx`;
    }
    checkAmbientLightSensorSupport();

    const mpInput = document.getElementById("cfg-mp-threshold");
    if (mpInput) {
      mpInput.value = config.mpHiltThreshold;
      const mpVal = document.getElementById("cfg-mp-threshold-val");
      if (mpVal) mpVal.textContent = `${config.mpHiltThreshold.toFixed(1)} cm`;
    }

    const retDistInput = document.getElementById("cfg-mp-retract-dist");
    if (retDistInput) {
      retDistInput.value = config.mpRetractDist;
      const retDistVal = document.getElementById("cfg-mp-retract-dist-val");
      if (retDistVal) retDistVal.textContent = `${config.mpRetractDist.toFixed(1)} cm`;
    }

    const tripXInput = document.getElementById("cfg-mp-tripwire-x");
    if (tripXInput) {
      tripXInput.value = Math.round(config.mpTripwireX * 100);
      const tripXVal = document.getElementById("cfg-mp-tripwire-x-val");
      if (tripXVal) tripXVal.textContent = `${Math.round(config.mpTripwireX * 100)}%`;
    }

    const retXInput = document.getElementById("cfg-mp-retract-x");
    if (retXInput) {
      retXInput.value = Math.round(config.mpRetractX * 100);
      const retXVal = document.getElementById("cfg-mp-retract-x-val");
      if (retXVal) retXVal.textContent = `${Math.round(config.mpRetractX * 100)}%`;
    }

    const tripYInput = document.getElementById("cfg-mp-tripwire-y");
    if (tripYInput) {
      tripYInput.value = Math.round(config.mpTripwireY * 100);
      const tripYVal = document.getElementById("cfg-mp-tripwire-y-val");
      if (tripYVal) tripYVal.textContent = `${Math.round(config.mpTripwireY * 100)}%`;
    }

    const retYInput = document.getElementById("cfg-mp-retract-y");
    if (retYInput) {
      retYInput.value = Math.round(config.mpRetractY * 100);
      const retYVal = document.getElementById("cfg-mp-retract-y-val");
      if (retYVal) retYVal.textContent = `${Math.round(config.mpRetractY * 100)}%`;
    }

    document.querySelectorAll("input[name='mp-mode']").forEach(r => {
      r.checked = (r.value === config.mpMode);
    });
    updateMediaPipeModeUI(config.mpMode);

    document.querySelectorAll("input[name='mp-side-dir']").forEach(r => {
      r.checked = (r.value === config.mpSideDir);
    });
    document.querySelectorAll("input[name='mp-top-dir']").forEach(r => {
      r.checked = (r.value === config.mpTopDir);
    });
    document.querySelectorAll("input[name='mp-mouth-lock']").forEach(r => {
      r.checked = (r.value === config.mpMouthLock);
    });
    const mouthSensInput = document.getElementById("cfg-mp-mouth-sens");
    if (mouthSensInput) {
      mouthSensInput.value = config.mpMouthSens;
      const mouthSensVal = document.getElementById("cfg-mp-mouth-sens-val");
      if (mouthSensVal) mouthSensVal.textContent = `${config.mpMouthSens}%`;
    }

    document.querySelectorAll("input[name='action-type']").forEach(r => {
      r.checked = (r.value === config.actionType);
    });

    onInputSourceChange(config.inputSource);
    updateOutputFields(document.getElementById("cfg-output-mode").value);
    syncDefaultIntensityToSetups(config.intensity);
  };
  populateSettings();

  sessionsTab.addEventListener("click", () => {
    setHubView("sessions");
    window.scrollTo({ top: 0 });
  });
  if (prisonTab) {
    prisonTab.addEventListener("click", () => {
      setHubView("prison");
      renderPrisonDashboard();
      window.scrollTo({ top: 0 });
    });
  }
  settingsTab.addEventListener("click", () => {
    setHubView("settings");
    window.scrollTo({ top: 0 });
  });
  document.getElementById("cfg-output-mode").addEventListener("change", event => {
    config.outputMode = event.target.value;
    localStorage.setItem("os_output_mode", config.outputMode);
    updateOutputFields(config.outputMode);
  });

  const inputSourceSel = document.getElementById("cfg-input-source");
  inputSourceSel.addEventListener("change", (e) => onInputSourceChange(e.target.value));

  document.getElementById("btn-save-settings").addEventListener("click", () => {
    config.outputMode = document.getElementById("cfg-output-mode").value;
    config.webhookUrl = document.getElementById("cfg-webhook-url").value.trim();
    config.webhookToken = document.getElementById("cfg-webhook-token").value.trim();
    config.rewardWebhookUrl = document.getElementById("cfg-reward-webhook-url").value.trim();
    config.rewardWebhookToken = document.getElementById("cfg-reward-webhook-token").value.trim();
    config.piUsername = document.getElementById("cfg-pishock-username").value.trim();
    config.piApiKey = document.getElementById("cfg-pishock-key").value.trim();
    config.piShareCode = document.getElementById("cfg-pishock-code").value.trim();
    config.token = document.getElementById("cfg-token").value.trim();
    config.shockerId = document.getElementById("cfg-shocker-id").value.trim();
    config.intensity = Math.max(1, Math.min(99, parseInt(document.getElementById("cfg-intensity").value, 10) || 20));
    config.duration = Math.max(100, Math.min(10000, parseInt(document.getElementById("cfg-duration").value, 10) || 1000));
    document.getElementById("cfg-intensity").value = config.intensity;
    document.getElementById("cfg-duration").value = config.duration;
    syncDefaultIntensityToSetups(config.intensity);
    config.inputSource = document.getElementById("cfg-input-source").value;

    const wsInput = document.getElementById("cfg-ws-url");
    if (wsInput) {
      config.wsUrl = wsInput.value.trim();
      localStorage.setItem("os_ws_url", config.wsUrl);
    }

    const luxInput = document.getElementById("cfg-lux-threshold");
    if (luxInput) {
      config.luxThreshold = parseInt(luxInput.value, 10);
      localStorage.setItem("os_lux_threshold", config.luxThreshold);
    }

    const mpInput = document.getElementById("cfg-mp-threshold");
    if (mpInput) {
      config.mpHiltThreshold = parseFloat(mpInput.value);
      localStorage.setItem("os_mp_hilt_threshold", config.mpHiltThreshold);
    }

    const retDistInput = document.getElementById("cfg-mp-retract-dist");
    if (retDistInput) {
      config.mpRetractDist = parseFloat(retDistInput.value);
      localStorage.setItem("os_mp_retract_dist", config.mpRetractDist);
    }

    const tripXInput = document.getElementById("cfg-mp-tripwire-x");
    if (tripXInput) {
      config.mpTripwireX = parseInt(tripXInput.value, 10) / 100;
      localStorage.setItem("os_mp_tripwire_x", config.mpTripwireX);
    }

    const retXInput = document.getElementById("cfg-mp-retract-x");
    if (retXInput) {
      config.mpRetractX = parseInt(retXInput.value, 10) / 100;
      localStorage.setItem("os_mp_retract_x", config.mpRetractX);
    }

    const tripYInput = document.getElementById("cfg-mp-tripwire-y");
    if (tripYInput) {
      config.mpTripwireY = parseInt(tripYInput.value, 10) / 100;
      localStorage.setItem("os_mp_tripwire_y", config.mpTripwireY);
    }

    const retYInput = document.getElementById("cfg-mp-retract-y");
    if (retYInput) {
      config.mpRetractY = parseInt(retYInput.value, 10) / 100;
      localStorage.setItem("os_mp_retract_y", config.mpRetractY);
    }

    const checkedMpMode = document.querySelector("input[name='mp-mode']:checked");
    if (checkedMpMode) {
      config.mpMode = checkedMpMode.value;
      localStorage.setItem("os_mp_mode", config.mpMode);
    }

    const checkedSideDir = document.querySelector("input[name='mp-side-dir']:checked");
    if (checkedSideDir) {
      config.mpSideDir = checkedSideDir.value;
      localStorage.setItem("os_mp_side_dir", config.mpSideDir);
    }

    const checkedTopDir = document.querySelector("input[name='mp-top-dir']:checked");
    if (checkedTopDir) {
      config.mpTopDir = checkedTopDir.value;
      localStorage.setItem("os_mp_top_dir", config.mpTopDir);
    }

    const checkedMouthLock = document.querySelector("input[name='mp-mouth-lock']:checked");
    if (checkedMouthLock) {
      config.mpMouthLock = checkedMouthLock.value;
      localStorage.setItem("os_mp_mouth_lock", config.mpMouthLock);
    }

    const mouthSensInput = document.getElementById("cfg-mp-mouth-sens");
    if (mouthSensInput) {
      config.mpMouthSens = parseInt(mouthSensInput.value, 10) || 40;
      localStorage.setItem("os_mp_mouth_sens", config.mpMouthSens);
    }

    const checkedAction = document.querySelector("input[name='action-type']:checked");
    if (checkedAction) config.actionType = checkedAction.value;

    localStorage.setItem("os_output_mode", config.outputMode);
    localStorage.setItem("os_webhook_url", config.webhookUrl);
    localStorage.setItem("os_webhook_token", config.webhookToken);
    localStorage.setItem("os_reward_webhook_url", config.rewardWebhookUrl);
    localStorage.setItem("os_reward_webhook_token", config.rewardWebhookToken);
    localStorage.setItem("os_pishock_username", config.piUsername);
    localStorage.setItem("os_pishock_key", config.piApiKey);
    localStorage.setItem("os_pishock_code", config.piShareCode);
    localStorage.setItem("os_token", config.token);
    localStorage.setItem("os_shocker_id", config.shockerId);
    localStorage.setItem("os_intensity", config.intensity);
    localStorage.setItem("os_duration", config.duration);
    localStorage.setItem("os_action_type", config.actionType);
    localStorage.setItem("os_input_source", config.inputSource);

    document.getElementById("settings-save-feedback").textContent = "Settings saved.";
  });

  document.getElementById("btn-test-reward-webhook").addEventListener("click", async () => {
    const feedback = document.getElementById("reward-test-feedback");
    feedback.textContent = "Sending test reward event...";
    const result = await sendRewardWebhook("test", {
      rewardWebhookUrl: document.getElementById("cfg-reward-webhook-url").value,
      rewardWebhookToken: document.getElementById("cfg-reward-webhook-token").value
    }, true);
    feedback.textContent = result.success
      ? `Test reward sent (HTTP ${result.code}).`
      : `Test failed: ${result.message}`;
  });

  document.getElementById("btn-test-action").addEventListener("click", async () => {
    const outputMode = document.getElementById("cfg-output-mode").value;
    const webhookOnly = outputMode === "webhook";
    const checkedAction = document.querySelector("input[name='action-type']:checked");
    const chosenAction = checkedAction ? checkedAction.value : config.actionType;
    const intensity = parseInt(document.getElementById("cfg-intensity").value, 10) || config.intensity;

    const feedback = document.getElementById("test-feedback");
    feedback.textContent = webhookOnly
      ? "Sending test punishment webhook..."
      : `Testing ${chosenAction} (${intensity}%)...`;
    feedback.style.color = "var(--crimson-accent)";

    const res = await sendPunishment(chosenAction, intensity, {
      outputMode,
      webhookUrl: document.getElementById("cfg-webhook-url").value.trim(),
      webhookToken: document.getElementById("cfg-webhook-token").value.trim(),
      piUsername: document.getElementById("cfg-pishock-username").value.trim(),
      piApiKey: document.getElementById("cfg-pishock-key").value.trim(),
      piShareCode: document.getElementById("cfg-pishock-code").value.trim(),
      token: document.getElementById("cfg-token").value.trim(),
      shockerId: document.getElementById("cfg-shocker-id").value.trim(),
      duration: parseInt(document.getElementById("cfg-duration").value, 10) || config.duration
    });
    if (res && res.success) {
      feedback.textContent = webhookOnly
        ? `Test punishment webhook sent (HTTP ${res.code}).`
        : `✓ ${chosenAction} Test Succeeded (HTTP ${res.code})`;
      feedback.style.color = "var(--emerald-active)";
    } else {
      feedback.textContent = `✗ Test Failed: ${res ? res.message || res.code : "Error"}`;
      feedback.style.color = "var(--red-punish)";
    }
  });
}

function onInputSourceChange(source) {
  const panelCam = document.getElementById("panel-camera");
  const panelAmb = document.getElementById("panel-ambient-light");
  const panelMp = document.getElementById("panel-mediapipe");
  const panelWs = document.getElementById("panel-websocket");

  if (panelCam) panelCam.classList.toggle("hidden", source !== "camera");
  if (panelAmb) panelAmb.classList.toggle("hidden", source !== "ambient-light");
  if (panelMp) panelMp.classList.toggle("hidden", source !== "mediapipe");
  if (panelWs) panelWs.classList.toggle("hidden", source !== "websocket");

  if (source === "mediapipe") {
    if (!isMediaPipeActive) startMediaPipeDepth();
  } else {
    if (isMediaPipeActive) stopMediaPipeDepth();
  }

  if (source === "ambient-light") {
    if (!isAmbientSensorActive) startAmbientLightSensor();
  } else {
    if (isAmbientSensorActive) stopAmbientLightSensor();
  }

  if (source === "camera") {
    if (!isCamActive) startCameraMeter();
  } else {
    if (isCamActive) stopCameraMeter();
  }
}

// ==========================================
// 13. HARDWARE GAMEPAD & CONTROLLER POLLING
// ==========================================
let gamepadPollRaf = null;
let lastGamepadDown = false;

function initGamepadPolling() {
  window.addEventListener("gamepadconnected", () => {
    if (!gamepadPollRaf) pollGamepad();
  });
  window.addEventListener("gamepaddisconnected", () => {});
  pollGamepad();
}

function pollGamepad() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  let isAnyDown = false;

  for (const gp of gamepads) {
    if (gp && gp.buttons) {
      for (const btn of gp.buttons) {
        if (btn.pressed || btn.value > 0.5) {
          isAnyDown = true;
          break;
        }
      }
    }
    if (isAnyDown) break;
  }

  if (config.inputSource === "gamepad") {
    if (isAnyDown !== lastGamepadDown) {
      lastGamepadDown = isAnyDown;
      handlePhysicalInputState(isAnyDown);
    }
  }

  gamepadPollRaf = requestAnimationFrame(pollGamepad);
}

// Global Unified Pointer Release / Cancel Handler (Guarantees all touch release / cancel events catch cleanly)
window.addEventListener("pointerup", () => {
  if (config.inputSource === "touch" && isPhysicalDown) {
    handlePhysicalInputState(false);
  }
});
window.addEventListener("pointercancel", () => {
  if (config.inputSource === "touch" && isPhysicalDown) {
    handlePhysicalInputState(false);
  }
});

// Global Navigation Back Button
document.getElementById("btn-nav-back").addEventListener("click", handleBackNavigation);

// Desktop keyboard input: hold Space (or Enter) = press/hold, Esc = go back
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (currentScreen !== "hub") handleBackNavigation();
    return;
  }

  if ((e.code === "Space" || e.key === "Enter") && !isTypingTarget(e.target)) {
    if (!currentScreen.startsWith("game-")) return; // don't hijack Space on setup pages (buttons)
    e.preventDefault();
    if (e.repeat) return; // holding the key must not spam taps
    if (config.inputSource === "touch") handlePhysicalInputState(true);
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space" || e.key === "Enter") {
    if (config.inputSource === "touch" && isPhysicalDown) {
      e.preventDefault();
      handlePhysicalInputState(false);
    }
  }
});
// Losing window focus while holding Space counts as a release (no stuck "held" state)
window.addEventListener("blur", () => {
  if (config.inputSource === "touch" && isPhysicalDown) handlePhysicalInputState(false);
});

// Game Cards on Hub
document.querySelectorAll(".game-card").forEach(card => {
  card.addEventListener("click", () => {
    const game = card.getAttribute("data-game");
    switchScreen(`setup-${game}`);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      card.click();
    }
  });
});

// ==========================================
// 14. DEEPTHROAT PRISON CAMPAIGN & SENSOR ARENA
// ==========================================
const PRISON_SENTENCE_TABLE = {
  1: 550,
  2: 600,
  3: 650,
  4: 700,
  5: 750,
  6: 800
};

const PRISON_TIERS = {
  basic: {
    name: "Basic Task",
    unlockPts: 0,
    tasks: {
      1: {
        roll: 1,
        pts: 2,
        img: "images/prison/basic-1.webp",
        title: "Deepthroat 50 times",
        sensorDesc: "Complete 50 full sensor reps.",
        stages: [{ type: "reps", targetReps: 50, maxBreakSec: 0, minRepHoldSec: 0 }]
      },
      2: {
        roll: 2,
        pts: 4,
        img: "images/prison/basic-2.webp",
        title: "Hold deepthroat for 30 sec",
        sensorDesc: "Hold continuously at target for 30 seconds without releasing.",
        stages: [{ type: "hold", holdSec: 30, sets: 1, maxBreakSec: 0 }]
      },
      3: {
        roll: 3,
        pts: 7,
        img: "images/prison/basic-3.webp",
        title: "Deepthroat 100 times",
        sensorDesc: "Complete 100 full sensor reps.",
        stages: [{ type: "reps", targetReps: 100, maxBreakSec: 0, minRepHoldSec: 0 }]
      },
      4: {
        roll: 4,
        pts: 11,
        img: "images/prison/basic-4.webp",
        title: "Deepthroat at 40 BPM for 1 min",
        sensorDesc: "Follow the 40 BPM metronome for 60s (max 4s break).",
        stages: [{ type: "bpm", bpm: 40, durationSec: 60, maxBreakSec: 4 }]
      },
      5: {
        roll: 5,
        pts: 16,
        img: "images/prison/basic-5.webp",
        title: "Deepthroat 30 clean deep reps (Unbroken Rhythm)",
        sensorDesc: "30 reps with ≥0.4s hold per rep and no pause over 3s.",
        stages: [{ type: "reps", targetReps: 30, maxBreakSec: 3, minRepHoldSec: 0.4 }]
      },
      6: {
        roll: 6,
        pts: 0,
        solitary: true,
        img: "images/prison/warden-basic.webp",
        title: "Sent to Punishment Cell",
        sensorDesc: "You are sent to the Basic Punishment Cell until you roll a Release instruction."
      }
    }
  },
  interm: {
    name: "Intermediate Task",
    unlockPts: 60,
    tasks: {
      1: {
        roll: 1,
        pts: 15,
        img: "images/prison/interm-1.webp",
        title: "Deepthroat 200 times",
        sensorDesc: "Complete 200 full sensor reps.",
        stages: [{ type: "reps", targetReps: 200, maxBreakSec: 0, minRepHoldSec: 0 }]
      },
      2: {
        roll: 2,
        pts: 17,
        img: "images/prison/interm-2.webp",
        title: "Hold deepthroat for 30 sec × 3 sets",
        sensorDesc: "Complete 3 sets of 30-second holds (max 8s break between sets).",
        stages: [{ type: "hold", holdSec: 30, sets: 3, maxBreakSec: 8 }]
      },
      3: {
        roll: 3,
        pts: 20,
        img: "images/prison/interm-3.webp",
        title: "Deepthroat at 60 BPM for 3 min (breaks ≤ 10s)",
        sensorDesc: "Follow the 60 BPM metronome for 180s. Any break over 10s fails.",
        stages: [{ type: "bpm", bpm: 60, durationSec: 180, maxBreakSec: 10 }]
      },
      4: {
        roll: 4,
        pts: 24,
        img: "images/prison/interm-4.webp",
        title: "Deep Hold Lock: 5 × 20 sec Holds",
        sensorDesc: "Complete 5 sets of 20-second deep holds (max 5s break).",
        stages: [{ type: "hold", holdSec: 20, sets: 5, maxBreakSec: 5 }]
      },
      5: {
        roll: 5,
        pts: 27,
        img: "images/prison/interm-5.webp",
        title: "Overdrive Gauntlet: 150 Reps + 45 sec Final Hold",
        sensorDesc: "Stage 1: 150 reps (max 5s break). Stage 2: 45s continuous hold.",
        stages: [
          { type: "reps", targetReps: 150, maxBreakSec: 5, minRepHoldSec: 0 },
          { type: "hold", holdSec: 45, sets: 1, maxBreakSec: 5 }
        ]
      },
      6: {
        roll: 6,
        pts: 0,
        solitary: true,
        img: "images/prison/warden-interm.webp",
        title: "Sent to Punishment Cell",
        sensorDesc: "You are sent to the Intermediate Punishment Cell until you roll Release."
      }
    }
  },
  adv: {
    name: "Advanced Task",
    unlockPts: 200,
    tasks: {
      1: {
        roll: 1,
        pts: 25,
        img: "images/prison/adv-1.webp",
        title: "Deepthroat 150 times in 2 min",
        sensorDesc: "Complete 150 sensor reps before the 120-second timer expires.",
        stages: [{ type: "reps", targetReps: 150, timeLimitSec: 120, maxBreakSec: 5, minRepHoldSec: 0 }]
      },
      2: {
        roll: 2,
        pts: 27,
        img: "images/prison/adv-2.webp",
        title: "Hold for 30 sec, 5 sec break, repeat 5 times",
        sensorDesc: "Complete 5 sets of 30-second holds with strict ≤5s breaks.",
        stages: [{ type: "hold", holdSec: 30, sets: 5, maxBreakSec: 5 }]
      },
      3: {
        roll: 3,
        pts: 30,
        img: "images/prison/adv-3.webp",
        title: "80 BPM Burst (1 min) → 90 BPM Endurance (3 min)",
        sensorDesc: "Stage 1: 80 BPM for 60s. Stage 2: 90 BPM for 180s (breaks ≤ 5s).",
        stages: [
          { type: "bpm", bpm: 80, durationSec: 60, maxBreakSec: 5 },
          { type: "bpm", bpm: 90, durationSec: 180, maxBreakSec: 5 }
        ]
      },
      4: {
        roll: 4,
        pts: 34,
        img: "images/prison/adv-4.webp",
        title: "3-Stage Lock: 10 Deep Twists → 10×10s Holds → 3×60s Holds",
        sensorDesc: "Stage 1: 10 slow 3s holds. Stage 2: 10×10s holds. Stage 3: 3×60s holds.",
        stages: [
          { type: "reps", targetReps: 10, maxBreakSec: 5, minRepHoldSec: 3.0 },
          { type: "hold", holdSec: 10, sets: 10, maxBreakSec: 5 },
          { type: "hold", holdSec: 60, sets: 3, maxBreakSec: 6 }
        ]
      },
      5: {
        roll: 5,
        pts: 40,
        img: "images/prison/adv-5.webp",
        title: "300 Reps Speed Sprint → 3 × 45 sec Deep Lock Holds",
        sensorDesc: "Stage 1: 300 fast reps (breaks ≤ 5s). Stage 2: 3 sets of 45s holds.",
        stages: [
          { type: "reps", targetReps: 300, maxBreakSec: 5, minRepHoldSec: 0 },
          { type: "hold", holdSec: 45, sets: 3, maxBreakSec: 5 }
        ]
      },
      6: {
        roll: 6,
        pts: 0,
        solitary: true,
        img: "images/prison/warden-adv.webp",
        title: "Sent to Punishment Cell",
        sensorDesc: "You are sent to the Advanced Punishment Cell until you roll Release."
      }
    }
  },
  final: {
    name: "The Final Task to Release",
    unlockPts: "target",
    tasks: {
      1: {
        roll: 1,
        pts: 0,
        isFinalRelease: true,
        cumulativeKey: "final1_reps",
        img: "images/prison/final-1.webp",
        title: "Deepthroat 5,000 times in a day",
        sensorDesc: "Cumulative 5,000 sensor reps (progress auto-saves as you go).",
        stages: [{ type: "reps", targetReps: 5000, maxBreakSec: 0, minRepHoldSec: 0, cumulativeKey: "final1_reps" }]
      },
      2: {
        roll: 2,
        pts: 0,
        isFinalRelease: true,
        cumulativeKey: "final2_hold",
        img: "images/prison/final-2.webp",
        title: "Hold deepthroat for a cumulative total of 30 min (1,800s)",
        sensorDesc: "Accumulate 1,800 seconds of sensor hold time today.",
        stages: [{ type: "hold", holdSec: 1800, sets: 1, maxBreakSec: 0, cumulativeKey: "final2_hold" }]
      },
      3: {
        roll: 3,
        pts: 0,
        isFinalRelease: true,
        roundsTotal: 10,
        roundKey: "final3_rounds",
        img: "images/prison/final-3.webp",
        title: "100 BPM for 5 min (breaks ≤ 3s) — 10 Rounds",
        sensorDesc: "Complete 300s at 100 BPM (breaks ≤ 3s), 10 times to earn release.",
        stages: [{ type: "bpm", bpm: 100, durationSec: 300, maxBreakSec: 3 }]
      },
      4: {
        roll: 4,
        pts: 0,
        isFinalRelease: true,
        roundsTotal: 10,
        roundKey: "final4_rounds",
        img: "images/prison/final-4.webp",
        title: "20 Deep Reps + 20 × 10s Holds — 10 Rounds",
        sensorDesc: "Complete 20 reps + 20 sets of 10s holds (breaks ≤ 4s), 10 times.",
        stages: [
          { type: "reps", targetReps: 20, maxBreakSec: 4, minRepHoldSec: 0.5 },
          { type: "hold", holdSec: 10, sets: 20, maxBreakSec: 4 }
        ]
      },
      5: {
        roll: 5,
        pts: 0,
        isFinalRelease: true,
        roundsTotal: 30,
        roundKey: "final5_rounds",
        img: "images/prison/final-5.webp",
        title: "30 × 60 sec Deep Endurance Lock Holds",
        sensorDesc: "Complete 30 cumulative rounds of 60-second deep holds (max 5s break).",
        stages: [{ type: "hold", holdSec: 60, sets: 1, maxBreakSec: 5 }]
      },
      6: {
        roll: 6,
        pts: 0,
        halvePoints: true,
        img: "images/prison/final-6.webp",
        title: "Guards Keep You Longer — Lose Half Your Points!",
        sensorDesc: "Prison guards really like your throat. You immediately lose half of your points!"
      }
    }
  }
};

const PRISON_PUNISHMENT_CELLS = {
  basic: {
    title: "BASIC PUNISHMENT CELL",
    img: "images/prison/warden-basic.webp",
    lore: "You were deemed to have an insufficient attitude of serving cock and were sent to the punishment cell. Here, a specialist in corrective education will administer your re-education until you roll a Release instruction.",
    rolls: {
      1: { release: true, title: "You are released." },
      2: {
        release: false,
        title: "Deepthroat 100 times.",
        sensorDesc: "Complete 100 sensor reps to satisfy the warden.",
        stages: [{ type: "reps", targetReps: 100, maxBreakSec: 5, minRepHoldSec: 0 }]
      },
      3: {
        release: false,
        title: "Hold deepthroat for 30 sec.",
        sensorDesc: "Hold continuously at target for 30 seconds without releasing.",
        stages: [{ type: "hold", holdSec: 30, sets: 1, maxBreakSec: 0 }]
      },
      4: { release: true, title: "You are released." },
      5: {
        release: false,
        title: "Hold 15 sec × 3 sets (max 4s break).",
        sensorDesc: "Complete 3 sets of 15-second holds without stalling.",
        stages: [{ type: "hold", holdSec: 15, sets: 3, maxBreakSec: 4 }]
      },
      6: { release: true, title: "You are released." }
    }
  },
  interm: {
    title: "INTERMEDIATE PUNISHMENT CELL",
    img: "images/prison/warden-interm.webp",
    lore: "Some of the correctional officers are not entirely serious about their duties. It seems that, while re-educating you, she also intends to use your throat for her own pleasure.",
    rolls: {
      1: { release: true, title: "You are released." },
      2: {
        release: false,
        title: "Deepthroat 200 times.",
        sensorDesc: "Complete 200 sensor reps (max 5s break).",
        stages: [{ type: "reps", targetReps: 200, maxBreakSec: 5, minRepHoldSec: 0 }]
      },
      3: {
        release: false,
        title: "Hold deepthroat for 60 sec.",
        sensorDesc: "Complete an unbroken 60-second deep hold without releasing.",
        stages: [{ type: "hold", holdSec: 60, sets: 1, maxBreakSec: 0 }]
      },
      4: { release: true, title: "You are released." },
      5: {
        release: false,
        title: "10 × 10 sec Deep Holds (max 4s break).",
        sensorDesc: "Complete 10 sets of 10-second holds.",
        stages: [{ type: "hold", holdSec: 10, sets: 10, maxBreakSec: 4 }]
      },
      6: {
        release: false,
        title: "Punishment Overdrive: 150 Reps + 30s Hold.",
        sensorDesc: "Complete 150 reps followed by a 30-second hold.",
        stages: [
          { type: "reps", targetReps: 150, maxBreakSec: 5, minRepHoldSec: 0 },
          { type: "hold", holdSec: 30, sets: 1, maxBreakSec: 4 }
        ]
      }
    }
  },
  adv: {
    title: "ADVANCED PUNISHMENT CELL",
    img: "images/prison/warden-adv.webp",
    lore: "There is a guard who is the most feared among the prisoners. What she inflicts is neither corrective education nor punishment, but sheer abuse.",
    rolls: {
      1: { release: true, title: "You are released." },
      2: {
        release: false,
        title: "Deepthroat 500 times.",
        sensorDesc: "Complete 500 sensor reps (max 5s break).",
        stages: [{ type: "reps", targetReps: 500, maxBreakSec: 5, minRepHoldSec: 0 }]
      },
      3: {
        release: false,
        title: "Hold for 30 sec, 5 sec break, repeat 5 times.",
        sensorDesc: "Complete 5 sets of 30-second holds (max 5s break).",
        stages: [{ type: "hold", holdSec: 30, sets: 5, maxBreakSec: 5 }]
      },
      4: {
        release: false,
        title: "10 Slow Deep Twist Holds (≥3s per rep).",
        sensorDesc: "Complete 10 slow deep reps holding each for at least 3 seconds.",
        stages: [{ type: "reps", targetReps: 10, maxBreakSec: 5, minRepHoldSec: 3.0 }]
      },
      5: {
        release: false,
        title: "20 × 10 sec Deep Holds (max 4s break).",
        sensorDesc: "Complete 20 sets of 10-second deep holds.",
        stages: [{ type: "hold", holdSec: 10, sets: 20, maxBreakSec: 4 }]
      },
      6: {
        release: false,
        title: "3 × 60 sec Lock Holds + 300 Reps.",
        sensorDesc: "Complete 3 sets of 60s holds, then 300 sensor reps.",
        stages: [
          { type: "hold", holdSec: 60, sets: 3, maxBreakSec: 5 },
          { type: "reps", targetReps: 300, maxBreakSec: 5, minRepHoldSec: 0 }
        ]
      }
    }
  }
};

function loadPrisonState() {
  try {
    const raw = localStorage.getItem("os_prison_campaign_v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      let activeAssign = parsed.activeAssignment && typeof parsed.activeAssignment === "object"
        ? parsed.activeAssignment
        : null;
      if (activeAssign && activeAssign.tierKey && activeAssign.roll) {
        if (activeAssign.mode === "solitary") {
          const cell = PRISON_PUNISHMENT_CELLS[activeAssign.tierKey];
          const item = cell && cell.rolls ? cell.rolls[activeAssign.roll] : null;
          if (item && !item.release) {
            activeAssign.title = item.title;
            activeAssign.sensorDesc = item.sensorDesc;
            activeAssign.stages = item.stages;
          }
        } else {
          const tier = PRISON_TIERS[activeAssign.tierKey];
          const task = tier && tier.tasks ? tier.tasks[activeAssign.roll] : null;
          if (task && task.stages) {
            activeAssign.title = task.title;
            activeAssign.sensorDesc = task.sensorDesc;
            activeAssign.stages = task.stages;
          }
        }
      }
      return {
        points: Math.max(0, Number(parsed.points) || 0),
        targetPts: Number(parsed.targetPts) || 0,
        sentenceRoll: Number(parsed.sentenceRoll) || 0,
        selectedTier: ["basic", "interm", "adv", "final"].includes(parsed.selectedTier) ? parsed.selectedTier : "basic",
        solitaryTier: ["basic", "interm", "adv"].includes(parsed.solitaryTier) ? parsed.solitaryTier : null,
        lastRoll: Number(parsed.lastRoll) || 0,
        clearedCount: Number(parsed.clearedCount) || 0,
        failedCount: Number(parsed.failedCount) || 0,
        solitaryCount: Number(parsed.solitaryCount) || 0,
        endingUnlocked: Boolean(parsed.endingUnlocked),
        activeAssignment: activeAssign,
        cumulative: parsed.cumulative && typeof parsed.cumulative === "object" ? parsed.cumulative : {}
      };
    }
  } catch (e) {}
  return {
    points: 0,
    targetPts: 0,
    sentenceRoll: 0,
    selectedTier: "basic",
    solitaryTier: null,
    lastRoll: 0,
    clearedCount: 0,
    failedCount: 0,
    solitaryCount: 0,
    endingUnlocked: false,
    activeAssignment: null,
    cumulative: {}
  };
}

let prisonState = loadPrisonState();
let pendingPrisonAssignment = prisonState.activeAssignment;

function savePrisonState() {
  prisonState.activeAssignment = pendingPrisonAssignment;
  try {
    localStorage.setItem("os_prison_campaign_v1", JSON.stringify(prisonState));
  } catch (e) {}
}

function isPrisonTierUnlocked(tierKey) {
  if (prisonState.targetPts <= 0) return tierKey === "basic";
  if (tierKey === "basic") return true;
  if (tierKey === "interm") return prisonState.points >= 60;
  if (tierKey === "adv") return prisonState.points >= 200;
  if (tierKey === "final") return prisonState.points >= prisonState.targetPts;
  return false;
}

function renderPrisonDashboard() {
  const ptsEl = document.getElementById("prison-current-pts");
  const targetEl = document.getElementById("prison-target-pts");
  const fillEl = document.getElementById("prison-progress-fill");
  const badgeEl = document.getElementById("prison-cell-badge");
  const unlockLbl = document.getElementById("prison-tier-unlock-label");
  const milestoneRel = document.getElementById("prison-milestone-release");
  const clearedEl = document.getElementById("prison-stat-cleared");
  const failedEl = document.getElementById("prison-stat-failed");
  const solitaryEl = document.getElementById("prison-stat-solitary");
  const sentenceBox = document.getElementById("prison-sentence-roll-box");
  const rollerBox = document.getElementById("prison-roller-box");
  const wardenCard = document.getElementById("prison-warden-card");
  const endingCard = document.getElementById("prison-ending-card");
  const gridEl = document.getElementById("prison-tasks-grid");

  if (!ptsEl || !gridEl) return;

  ptsEl.textContent = String(prisonState.points);
  targetEl.textContent = prisonState.targetPts > 0 ? String(prisonState.targetPts) : "???";
  if (milestoneRel) {
    milestoneRel.textContent = prisonState.targetPts > 0 ? `${prisonState.targetPts} Release` : "Release Goal";
  }

  const pct = prisonState.targetPts > 0
    ? Math.min(100, Math.round((prisonState.points / prisonState.targetPts) * 100))
    : 0;
  if (fillEl) fillEl.style.width = `${pct}%`;

  if (clearedEl) clearedEl.textContent = String(prisonState.clearedCount);
  if (failedEl) failedEl.textContent = String(prisonState.failedCount);
  if (solitaryEl) solitaryEl.textContent = String(prisonState.solitaryCount);

  if (prisonState.solitaryTier) {
    badgeEl.textContent = "PUNISHMENT CELL";
    badgeEl.className = "prison-cell-badge solitary";
    unlockLbl.textContent = `Locked in ${prisonState.solitaryTier.toUpperCase()} Solitary — Roll Release to escape`;
  } else if (prisonState.endingUnlocked) {
    badgeEl.textContent = "SENTENCE SERVED";
    badgeEl.className = "prison-cell-badge normal";
    unlockLbl.textContent = "Campaign Complete — Ending Unlocked Below";
  } else {
    badgeEl.textContent = "COMMUNAL CELL";
    badgeEl.className = "prison-cell-badge normal";
    if (prisonState.targetPts <= 0) {
      unlockLbl.textContent = "Roll sentence to begin";
    } else if (prisonState.points >= prisonState.targetPts) {
      unlockLbl.textContent = "Final Release Task Unlocked!";
    } else if (prisonState.points >= 200) {
      unlockLbl.textContent = "Advanced Tasks Unlocked (200+ pts)";
    } else if (prisonState.points >= 60) {
      unlockLbl.textContent = "Intermediate Tasks Unlocked (60+ pts)";
    } else {
      unlockLbl.textContent = `${Math.max(0, 60 - prisonState.points)} pts until Intermediate Tier`;
    }
  }

  const hasSentence = prisonState.targetPts > 0;
  if (sentenceBox) sentenceBox.classList.toggle("hidden", hasSentence);
  if (rollerBox) rollerBox.classList.toggle("hidden", !hasSentence);
  if (endingCard) endingCard.classList.toggle("hidden", !prisonState.endingUnlocked);

  const rollBtn = document.getElementById("btn-prison-roll-task");
  const startBtn = document.getElementById("btn-prison-start-task");
  const diceFace = document.getElementById("prison-dice-face");
  const titleEl = document.getElementById("prison-roll-title");
  const descEl = document.getElementById("prison-roll-desc");
  const tierTabsWrap = document.querySelector(".prison-tier-tabs");

  if (pendingPrisonAssignment) {
    // Task is locked in — NO REROLLS ALLOWED until completed or forfeited inside the task arena
    if (rollBtn) rollBtn.classList.add("hidden");
    if (startBtn) {
      if (pendingPrisonAssignment.mode === "solitary") {
        startBtn.textContent = pendingPrisonAssignment.failedLastAttempt
          ? `RETRY SOLITARY TASK (X=${pendingPrisonAssignment.roll})`
          : `START SOLITARY TASK (X=${pendingPrisonAssignment.roll})`;
      } else if (pendingPrisonAssignment.roundKey && pendingPrisonAssignment.roundsTotal > 1) {
        const done = Math.floor(Number(prisonState.cumulative[pendingPrisonAssignment.roundKey]) || 0);
        startBtn.textContent = `START ROUND ${done + 1} OF ${pendingPrisonAssignment.roundsTotal} (X=${pendingPrisonAssignment.roll})`;
      } else if (pendingPrisonAssignment.cumulativeKey) {
        const saved = Math.floor(Number(prisonState.cumulative[pendingPrisonAssignment.cumulativeKey]) || 0);
        startBtn.textContent = saved > 0
          ? `RESUME CUMULATIVE TASK (X=${pendingPrisonAssignment.roll})`
          : `START SENSOR TASK (X=${pendingPrisonAssignment.roll})`;
      } else {
        startBtn.textContent = `START SENSOR TASK (X=${pendingPrisonAssignment.roll})`;
      }
      startBtn.classList.remove("hidden");
    }
    if (diceFace) diceFace.textContent = `X=${pendingPrisonAssignment.roll}`;
    if (titleEl) {
      if (pendingPrisonAssignment.mode === "solitary" && pendingPrisonAssignment.failedLastAttempt) {
        titleEl.textContent = `Solitary Failed (X=${pendingPrisonAssignment.roll}) — Must Retry: ${pendingPrisonAssignment.title}`;
      } else {
        titleEl.textContent = pendingPrisonAssignment.mode === "solitary"
          ? `Solitary Roll X=${pendingPrisonAssignment.roll}: ${pendingPrisonAssignment.title}`
          : `X=${pendingPrisonAssignment.roll}: ${pendingPrisonAssignment.title} ${pendingPrisonAssignment.pts > 0 ? `(+${pendingPrisonAssignment.pts} pts)` : "(FINAL RELEASE)"}`;
      }
    }
    if (descEl) {
      descEl.textContent = pendingPrisonAssignment.mode === "solitary" && pendingPrisonAssignment.failedLastAttempt
        ? `${pendingPrisonAssignment.lastFailReason || "Task failed!"} You MUST complete this solitary task before rolling again.`
        : `${pendingPrisonAssignment.sensorDesc} (Locked — no rerolls allowed.)`;
    }
  } else {
    if (rollBtn) {
      rollBtn.textContent = prisonState.solitaryTier
        ? "ROLL PUNISHMENT CELL (1D6)"
        : "ROLL TASK (1D6)";
      rollBtn.classList.remove("hidden");
    }
    if (startBtn) startBtn.classList.add("hidden");
  }

  // Render Punishment Cell Warden Card if in solitary
  if (prisonState.solitaryTier && PRISON_PUNISHMENT_CELLS[prisonState.solitaryTier]) {
    const cell = PRISON_PUNISHMENT_CELLS[prisonState.solitaryTier];
    wardenCard.classList.remove("hidden");
    if (tierTabsWrap) tierTabsWrap.classList.add("hidden");
    gridEl.classList.add("hidden");
    document.getElementById("prison-warden-img").src = cell.img;
    document.getElementById("prison-warden-title").textContent = cell.title;
    document.getElementById("prison-warden-lore").textContent = cell.lore;

    const tableEl = document.getElementById("prison-warden-table");
    tableEl.innerHTML = "";
    for (let r = 1; r <= 6; r++) {
      const item = cell.rolls[r];
      const row = document.createElement("div");
      row.className = "prison-warden-row" +
        (item.release ? " release-row" : "") +
        (prisonState.lastRoll === r ? " active-roll" : "");
      row.innerHTML = `<span><b>${r}.</b> ${item.title}</span><span>${item.release ? "RELEASE" : "TASK"}</span>`;
      tableEl.appendChild(row);
    }
    return;
  } else if (wardenCard) {
    wardenCard.classList.add("hidden");
    if (tierTabsWrap) tierTabsWrap.classList.remove("hidden");
    gridEl.classList.remove("hidden");
  }

  // Update Tier Tabs
  if (!isPrisonTierUnlocked(prisonState.selectedTier)) {
    if (isPrisonTierUnlocked("final")) prisonState.selectedTier = "final";
    else if (isPrisonTierUnlocked("adv")) prisonState.selectedTier = "adv";
    else if (isPrisonTierUnlocked("interm")) prisonState.selectedTier = "interm";
    else prisonState.selectedTier = "basic";
  }
  document.querySelectorAll(".prison-tier-tab").forEach(btn => {
    const t = btn.getAttribute("data-prison-tier");
    const unlocked = isPrisonTierUnlocked(t);
    btn.classList.toggle("active", t === prisonState.selectedTier);
    btn.classList.toggle("locked", !unlocked || Boolean(pendingPrisonAssignment));
  });

  // Render 6-Card Roulette Grid for Selected Tier (reference board; rolling is strictly via 1D6 button)
  const tierObj = PRISON_TIERS[prisonState.selectedTier] || PRISON_TIERS.basic;
  gridEl.innerHTML = "";
  for (let r = 1; r <= 6; r++) {
    const t = tierObj.tasks[r];
    const card = document.createElement("div");
    const isRolled = Boolean(
      pendingPrisonAssignment &&
      pendingPrisonAssignment.mode === "normal" &&
      pendingPrisonAssignment.tierKey === prisonState.selectedTier &&
      pendingPrisonAssignment.roll === r
    );
    card.className = "prison-task-card" +
      (isRolled ? " rolled" : "") +
      (t.solitary || t.halvePoints ? " solitary-card" : "");

    let badgeRight = t.pts > 0 ? `+${t.pts} pts` : (t.solitary ? "SOLITARY" : (t.halvePoints ? "-50% PTS" : "RELEASE"));
    let progressNote = "";
    if (t.cumulativeKey) {
      const cur = Math.floor(Number(prisonState.cumulative[t.cumulativeKey]) || 0);
      progressNote = ` <b style="color:#fff;">(Saved: ${cur})</b>`;
    } else if (t.roundKey) {
      const cur = Math.floor(Number(prisonState.cumulative[t.roundKey]) || 0);
      progressNote = ` <b style="color:#fff;">(Rounds: ${cur}/${t.roundsTotal})</b>`;
    }

    card.innerHTML = `
      <img class="prison-task-img card-image" src="${t.img}" alt="X=${r}" loading="lazy">
      <div class="prison-task-body">
        <div class="prison-task-head">
          <span class="prison-dice-badge">X = ${r}</span>
          <span class="prison-pts-badge">${badgeRight}</span>
        </div>
        <div class="prison-task-title">${t.title}</div>
        <div class="prison-task-sensor">${t.sensorDesc}${progressNote}</div>
      </div>
    `;
    gridEl.appendChild(card);
  }
}

function selectPrisonSolitaryRoll(roll) {
  if (pendingPrisonAssignment) return; // Cannot reroll an active task
  const cellKey = prisonState.solitaryTier;
  const cell = PRISON_PUNISHMENT_CELLS[cellKey];
  if (!cell) return;
  prisonState.lastRoll = roll;
  const item = cell.rolls[roll];

  const diceFace = document.getElementById("prison-dice-face");
  const titleEl = document.getElementById("prison-roll-title");
  const descEl = document.getElementById("prison-roll-desc");

  if (diceFace) diceFace.textContent = `X=${roll}`;

  if (item.release) {
    playTone(880, 180, "sine");
    prisonState.solitaryTier = null;
    prisonState.lastRoll = 0;
    pendingPrisonAssignment = null;
    savePrisonState();
    if (titleEl) titleEl.textContent = `Rolled ${roll}: RELEASED FROM PUNISHMENT CELL`;
    if (descEl) descEl.textContent = "You rolled a release instruction and have been returned to the communal cell.";
    renderPrisonDashboard();
    return;
  }

  pendingPrisonAssignment = {
    mode: "solitary",
    tierKey: cellKey,
    roll,
    pts: 0,
    img: cell.img,
    title: item.title,
    sensorDesc: item.sensorDesc,
    stages: item.stages
  };
  savePrisonState();
  renderPrisonDashboard();
}

function selectPrisonNormalRoll(tierKey, roll) {
  if (pendingPrisonAssignment) return; // Cannot reroll an active task
  const tierObj = PRISON_TIERS[tierKey];
  if (!tierObj) return;
  const task = tierObj.tasks[roll];
  if (!task) return;

  prisonState.lastRoll = roll;
  const diceFace = document.getElementById("prison-dice-face");
  const titleEl = document.getElementById("prison-roll-title");
  const descEl = document.getElementById("prison-roll-desc");

  if (diceFace) diceFace.textContent = `X=${roll}`;

  if (task.solitary) {
    playTone(190, 350, "sawtooth");
    sendPunishment(null, config.intensity);
    prisonState.solitaryTier = tierKey;
    prisonState.solitaryCount++;
    prisonState.lastRoll = 0;
    pendingPrisonAssignment = null;
    savePrisonState();
    if (titleEl) titleEl.textContent = `ROLLED 6 — SENT TO ${tierKey.toUpperCase()} PUNISHMENT CELL`;
    if (descEl) descEl.textContent = "Roll 1d6 in the Punishment Cell and complete re-education tasks until you roll a Release instruction.";
    renderPrisonDashboard();
    return;
  }

  if (task.halvePoints) {
    playTone(170, 400, "sawtooth");
    sendPunishment(null, config.intensity);
    prisonState.points = Math.floor(prisonState.points / 2);
    prisonState.failedCount++;
    prisonState.lastRoll = 0;
    pendingPrisonAssignment = null;
    savePrisonState();
    if (titleEl) titleEl.textContent = `ROLLED 6 — GUARDS KEEP YOU LONGER`;
    if (descEl) descEl.textContent = `You lost half of your points! Current total: ${prisonState.points} pts.`;
    renderPrisonDashboard();
    return;
  }

  pendingPrisonAssignment = {
    mode: "normal",
    tierKey,
    roll,
    pts: task.pts,
    img: task.img,
    title: task.title,
    sensorDesc: task.sensorDesc,
    stages: task.stages,
    isFinalRelease: Boolean(task.isFinalRelease),
    cumulativeKey: task.cumulativeKey || null,
    roundKey: task.roundKey || null,
    roundsTotal: task.roundsTotal || 0
  };
  savePrisonState();
  renderPrisonDashboard();
}

// ==========================================
// LIVE PRISON SENSOR ARENA ENGINE
// ==========================================
let prisonGameActive = false;
let prisonStageIdx = 0;
let prisonSetIdx = 1;
let prisonRepsDone = 0;
let prisonHoldSecDone = 0;
let prisonStageTimeElapsed = 0;
let prisonBreakSecElapsed = 0;
let prisonCurrentRepHoldSec = 0;
let prisonHasStartedStage = false;
let prisonStagePrepRemaining = 0;
let prisonHoldSetInProgress = false;
let prisonWaitingForBreakRelease = false;
let prisonTicker = null;
let prisonBpmTimestamps = [];
let prisonLiveBpm = 0;
let prisonBpmRemaining = 0;
let prisonExpectedBeatFraction = 0;
let prisonExpectedBeats = 0;
let prisonBpmDebt = 0;
let prisonPenaltyActive = false;
let prisonPenaltyHoldRemaining = 5.0;
let prisonPenaltyReason = "";

function stopPrisonGame() {
  prisonGameActive = false;
  prisonPenaltyActive = false;
  if (prisonTicker) {
    clearInterval(prisonTicker);
    prisonTicker = null;
  }
  stopBpmPacer();
  stopPunishLoop();
  const forfeitBtn = document.getElementById("btn-prison-forfeit");
  if (forfeitBtn) {
    forfeitBtn.disabled = false;
  }
}

function resetPrisonGameArena() {
  stopPrisonGame();
  if (!pendingPrisonAssignment || !pendingPrisonAssignment.stages || !pendingPrisonAssignment.stages.length) {
    switchScreen("hub");
    return;
  }
  prisonStageIdx = 0;
  setupPrisonStage(0);
}

function setupPrisonStage(idx) {
  stopBpmPacer();
  stopPunishLoop();
  prisonPenaltyActive = false;
  prisonStageIdx = idx;
  const assign = pendingPrisonAssignment;
  const stage = assign.stages[idx];
  isRepStrokeArmed = !(idx > 0 && config.inputSource === "mediapipe" && isPhysicalDown);
  prisonSetIdx = 1;
  prisonRepsDone = stage.cumulativeKey ? Math.floor(Number(prisonState.cumulative[stage.cumulativeKey]) || 0) : 0;
  prisonHoldSecDone = stage.cumulativeKey ? (Number(prisonState.cumulative[stage.cumulativeKey]) || 0) : 0;
  prisonStageTimeElapsed = 0;
  prisonBreakSecElapsed = 0;
  prisonCurrentRepHoldSec = 0;
  prisonHasStartedStage = false;
  prisonStagePrepRemaining = idx > 0 ? 5.0 : 0;
  prisonHoldSetInProgress = false;
  prisonWaitingForBreakRelease = false;
  prisonBpmTimestamps = [];
  prisonLiveBpm = 0;
  prisonBpmRemaining = stage.type === "bpm" ? stage.durationSec : 0;
  prisonExpectedBeatFraction = 0;
  prisonExpectedBeats = 0;
  prisonBpmDebt = 0;
  prisonGameActive = true;

  document.getElementById("prison-game-tier-pill").textContent =
    assign.mode === "solitary" ? `SOLITARY X=${assign.roll}` : `${assign.tierKey.toUpperCase()} X=${assign.roll}`;
  document.getElementById("prison-game-stage-pill").textContent =
    `STAGE ${idx + 1} OF ${assign.stages.length}`;
  document.getElementById("prison-game-stake-pill").textContent =
    assign.pts > 0 ? `+${assign.pts} / -${assign.pts} PTS` : (assign.isFinalRelease ? "RELEASE TASK" : "RE-EDUCATION");
  document.getElementById("prison-game-intensity-pill").textContent = `DEVICE: ${config.intensity}%`;

  document.getElementById("prison-arena-img").src = assign.img;
  document.getElementById("prison-arena-title").textContent = assign.title;
  document.getElementById("prison-arena-rule").textContent = assign.sensorDesc;
  const forfeitBtn = document.getElementById("btn-prison-forfeit");
  if (forfeitBtn) {
    forfeitBtn.textContent = assign.mode === "solitary"
      ? "Give Up Attempt (Punish & Must Retry)"
      : "Forfeit Task (Deduct Points & Punish)";
  }

  const pacerCue = document.getElementById("prison-pacer-cue");
  const debtPill = document.getElementById("prison-debt-pill");
  const breakBox = document.getElementById("prison-break-box");
  const delayBox = document.getElementById("prison-delay-box");
  if (delayBox) delayBox.classList.add("hidden");

  if (stage.type === "bpm") {
    pacerCue.classList.remove("hidden");
    if (debtPill) {
      debtPill.classList.remove("hidden", "has-debt", "critical-debt");
    }
    if (breakBox) breakBox.classList.add("hidden");
    refreshBpmCuePillIdle("prison-pacer-cue");
    if (prisonStagePrepRemaining <= 0) {
      startBpmPacer(stage.bpm, "prison-pacer-cue", "prison-arena", false);
    }
  } else {
    pacerCue.classList.add("hidden");
    if (debtPill) debtPill.classList.add("hidden");
    if (breakBox) breakBox.classList.remove("hidden");
  }

  updatePrisonArenaReadout();
  if (prisonStagePrepRemaining > 0) {
    setUnifiedGameState(
      "can-release",
      `STAGE ${idx} CLEARED! 5s PREP BREAK`,
      `Stop moving & catch your breath. Stage ${idx + 1} arms when countdown reaches 0.0s!`
    );
  } else {
    setUnifiedGameState(
      "pause",
      stage.type === "bpm" ? "START TAPPING TO BEGIN" : "ENGAGE SENSOR TO START",
      stage.type === "bpm"
        ? `Follow the DOWN beat cue to match ${stage.bpm} BPM!`
        : (stage.type === "hold" && !stage.cumulativeKey
            ? "Once engaged, DO NOT RELEASE until the hold countdown reaches 0.0s!"
            : "Reach target line or hold Space/Touch to begin.")
    );
  }

  if (prisonTicker) clearInterval(prisonTicker);
  prisonTicker = setInterval(tickPrisonArena, 100);
}

function updatePrisonArenaReadout() {
  if (!pendingPrisonAssignment) return;

  const timerEl = document.getElementById("prison-game-timer");
  const breakEl = document.getElementById("prison-game-break");
  const primaryEl = document.getElementById("prison-game-primary");
  const unitEl = document.getElementById("prison-game-unit");
  const fillEl = document.getElementById("prison-game-progress-fill");

  if (prisonPenaltyActive) {
    if (timerEl) timerEl.textContent = `PENALTY: ${prisonPenaltyHoldRemaining.toFixed(1)}s`;
    if (breakEl) breakEl.textContent = isPhysicalDown ? "HOLDING (SAFE)" : "SHOCKING (2s)";
    if (primaryEl) primaryEl.textContent = prisonPenaltyHoldRemaining.toFixed(1);
    if (unitEl) unitEl.textContent = isPhysicalDown ? "HOLD DEEP FOR 5s TO CLEAR PENALTY" : "RELEASED — SHOCK ACTIVE EVERY 2s!";
    const pct = ((5.0 - prisonPenaltyHoldRemaining) / 5.0) * 100;
    if (fillEl) fillEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    return;
  }

  const stage = pendingPrisonAssignment.stages[prisonStageIdx];
  if (!stage) return;

  if (prisonStagePrepRemaining > 0) {
    timerEl.textContent = `PREP: ${prisonStagePrepRemaining.toFixed(1)}s`;
    breakEl.textContent = "STAGE BREAK";
    primaryEl.textContent = `${prisonStagePrepRemaining.toFixed(1)}s`;
    unitEl.textContent = stage.type === "hold"
      ? `NEXT: ${stage.sets > 1 ? `${stage.sets} × ` : ""}${stage.holdSec}s HOLD`
      : (stage.type === "bpm" ? `NEXT: ${stage.bpm} BPM` : `NEXT: ${stage.targetReps} REPS`);
    if (fillEl) fillEl.style.width = "0%";
    return;
  }

  if (stage.timeLimitSec) {
    const rem = Math.max(0, stage.timeLimitSec - prisonStageTimeElapsed);
    timerEl.textContent = `${rem.toFixed(1)}s left`;
  } else if (stage.type === "bpm") {
    timerEl.textContent = `${prisonBpmRemaining.toFixed(1)}s`;
  } else {
    timerEl.textContent = `${prisonStageTimeElapsed.toFixed(1)}s`;
  }

  if (stage.type === "hold" && !stage.cumulativeKey && prisonHoldSetInProgress) {
    breakEl.textContent = "NO RELEASE ALLOWED";
  } else if (stage.maxBreakSec > 0) {
    const remBreak = Math.max(0, stage.maxBreakSec - prisonBreakSecElapsed);
    breakEl.textContent = `${remBreak.toFixed(1)}s / ${stage.maxBreakSec}s`;
  } else {
    breakEl.textContent = stage.type === "hold" && !stage.cumulativeKey ? "NO RELEASE ALLOWED" : "Unlimited";
  }

  let pct = 0;
  if (stage.type === "reps") {
    primaryEl.textContent = `${prisonRepsDone} / ${stage.targetReps}`;
    if (stage.minRepHoldSec > 0 && isPhysicalDown && isRepStrokeArmed && prisonCurrentRepHoldSec > 0) {
      unitEl.textContent = `HOLDING REP: ${prisonCurrentRepHoldSec.toFixed(1)}s / ${stage.minRepHoldSec.toFixed(1)}s`;
    } else {
      unitEl.textContent = stage.minRepHoldSec > 0
        ? `REPS (HOLD ≥ ${stage.minRepHoldSec.toFixed(1)}s EACH)`
        : "REPS COMPLETED";
    }
    pct = (prisonRepsDone / stage.targetReps) * 100;
  } else if (stage.type === "hold") {
    const remHold = Math.max(0, stage.holdSec - prisonHoldSecDone);
    primaryEl.textContent = `${remHold.toFixed(1)}s`;
    unitEl.textContent = stage.sets > 1
      ? `HOLD SET ${prisonSetIdx} OF ${stage.sets}`
      : (stage.cumulativeKey ? "CUMULATIVE HOLD REMAINING" : "UNBROKEN HOLD REMAINING");
    pct = (((prisonSetIdx - 1) * stage.holdSec + prisonHoldSecDone) / (stage.sets * stage.holdSec)) * 100;
  } else if (stage.type === "bpm") {
    primaryEl.textContent = prisonLiveBpm > 0 ? String(prisonLiveBpm) : "…";
    unitEl.textContent = `CADENCE • TARGET: ${stage.bpm} BPM`;
    const beatsReadout = document.getElementById("prison-beats-readout");
    if (beatsReadout) beatsReadout.textContent = `${prisonRepsDone} / ${prisonExpectedBeats}`;
    const debtVal = document.getElementById("prison-debt-val");
    if (debtVal) debtVal.textContent = String(prisonBpmDebt);
    const debtPill = document.getElementById("prison-debt-pill");
    if (debtPill) {
      debtPill.classList.toggle("has-debt", prisonBpmDebt > 0);
    }
    pct = ((stage.durationSec - prisonBpmRemaining) / stage.durationSec) * 100;
  }

  if (fillEl) fillEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function handlePrisonSensorInput(isDown) {
  if (!prisonGameActive || !pendingPrisonAssignment) return;

  if (prisonPenaltyActive) {
    if (isDown) {
      stopPunishLoop();
      playTone(620, 50, "sine");
      setUnifiedGameState(
        "holding",
        `PENALTY HOLD: ${prisonPenaltyHoldRemaining.toFixed(1)}s`,
        "FEEDBACK STOPPED — Keep holding deep for 5.0s unbroken to clear penalty!"
      );
    } else {
      prisonPenaltyHoldRemaining = 5.0;
      startPunishLoop(config.intensity, 2000);
      setUnifiedGameState(
        "punish",
        "RELEASED! FEEDBACK FIRING EVERY 2s!",
        "ENGAGE SENSOR & HOLD DEEP FOR 5.0s TO STOP FEEDBACK!"
      );
    }
    updatePrisonArenaReadout();
    return;
  }

  const stage = pendingPrisonAssignment.stages[prisonStageIdx];
  if (!stage) return;

  // During the 5s transition break between stages, ignore strokes so the player can decelerate safely
  if (prisonStagePrepRemaining > 0) {
    if (!isDown && config.inputSource !== "mediapipe") {
      isRepStrokeArmed = true;
    }
    return;
  }

  if (stage.type === "bpm") {
    if (isDown) {
      if (isRepStrokeArmed) {
        isRepStrokeArmed = false;
        const now = Date.now();
        prisonBpmTimestamps.push(now);
        prisonRepsDone++;
        playTone(800, 30);
        if (!prisonHasStartedStage) {
          prisonHasStartedStage = true;
          prisonBreakSecElapsed = 0;
          startBpmPacer(stage.bpm, "prison-pacer-cue", "prison-arena", false);
        }
      }
    } else {
      if (config.inputSource !== "mediapipe") {
        isRepStrokeArmed = true;
      }
    }
    updatePrisonArenaReadout();
    return;
  }

  if (isDown) {
    if (!prisonHasStartedStage) {
      prisonHasStartedStage = true;
    }
    stopPunishLoop();

    if (stage.type === "reps") {
      if (isRepStrokeArmed) {
        if (!stage.minRepHoldSec || stage.minRepHoldSec <= 0) {
          prisonRepsDone++;
          prisonBreakSecElapsed = 0;
          const delayBox = document.getElementById("prison-delay-box");
          if (delayBox) delayBox.classList.add("hidden");
          isRepStrokeArmed = false;
          playTone(620, 45, "sine");
          if (stage.cumulativeKey) {
            prisonState.cumulative[stage.cumulativeKey] = prisonRepsDone;
            savePrisonState();
          }
          if (stage.type === "reps" && prisonRepsDone >= stage.targetReps) {
            advanceOrCompletePrisonTask();
            return;
          }
        } else {
          prisonBreakSecElapsed = 0;
          const delayBox = document.getElementById("prison-delay-box");
          if (delayBox) delayBox.classList.add("hidden");
        }
      }
      setUnifiedGameState(
        "holding",
        stage.minRepHoldSec > 0 ? "HOLDING REP..." : "ENGAGED ✓",
        stage.minRepHoldSec > 0 ? `Keep holding for ${stage.minRepHoldSec.toFixed(1)}s to count rep` : "Retract to arm next rep"
      );
    } else if (stage.type === "hold") {
      prisonBreakSecElapsed = 0;
      const delayBox = document.getElementById("prison-delay-box");
      if (delayBox) delayBox.classList.add("hidden");
      prisonWaitingForBreakRelease = false;
      prisonHoldSetInProgress = true;
      setUnifiedGameState(
        "holding",
        stage.cumulativeKey ? "HOLDING (CUMULATIVE PROGRESS SAVED)" : "LOCKED IN HOLD — DO NOT RELEASE!",
        stage.cumulativeKey ? "Keep holding to accumulate time toward your release goal." : "Releasing before 0.0s immediately fails the task!"
      );
    }
  } else {
    const releasedEarlyOnHoldRep = stage.type === "reps" && stage.minRepHoldSec > 0 && isRepStrokeArmed && prisonCurrentRepHoldSec > 0;
    prisonCurrentRepHoldSec = 0;
    if (config.inputSource !== "mediapipe") {
      isRepStrokeArmed = true;
    }
    if (prisonHasStartedStage) {
      if (stage.type === "hold" && !stage.cumulativeKey) {
        if (prisonHoldSetInProgress) {
          // Released during an active continuous hold set -> IMMEDIATE FAIL!
          failPrisonTask("Released during a mandatory continuous hold!");
          return;
        }
        if (prisonWaitingForBreakRelease) {
          prisonWaitingForBreakRelease = false;
          setUnifiedGameState(
            "pause",
            `BETWEEN-SET BREAK (${stage.maxBreakSec || 5}s MAX)`,
            `Engage within ${Math.max(0, (stage.maxBreakSec || 5) - prisonBreakSecElapsed).toFixed(1)}s to lock in Set ${prisonSetIdx}!`
          );
        }
      } else {
        if (stage.type === "hold" && stage.cumulativeKey) {
          prisonState.cumulative[stage.cumulativeKey] = Math.round(prisonHoldSecDone * 10) / 10;
          savePrisonState();
        }
        setUnifiedGameState(
          "pause",
          stage.type === "hold"
            ? "HOLD PAUSED"
            : (releasedEarlyOnHoldRep ? `RELEASED TOO EARLY (< ${stage.minRepHoldSec.toFixed(1)}s)!` : "RETRACTED / READY"),
          stage.maxBreakSec > 0 ? `Re-engage within ${stage.maxBreakSec}s or task fails!` : "Engage sensor to continue"
        );
      }
    } else {
      setUnifiedGameState(
        "pause",
        "ENGAGE SENSOR TO START",
        stage.type === "hold" && !stage.cumulativeKey
          ? "Once engaged, DO NOT RELEASE until the hold countdown reaches 0.0s!"
          : "Reach target line or hold Space/Touch to begin."
      );
    }
  }
  updatePrisonArenaReadout();
}

function tickPrisonArena() {
  if (!prisonGameActive || !pendingPrisonAssignment) return;

  if (prisonPenaltyActive) {
    if (isPhysicalDown) {
      stopPunishLoop();
      prisonPenaltyHoldRemaining = Math.max(0, Math.round((prisonPenaltyHoldRemaining - 0.1) * 10) / 10);
      setUnifiedGameState(
        "holding",
        `PENALTY HOLD: ${prisonPenaltyHoldRemaining.toFixed(1)}s`,
        "FEEDBACK STOPPED — Keep holding deep for 5.0s unbroken to clear penalty!"
      );
      if (prisonPenaltyHoldRemaining <= 0) {
        finishPrisonPenaltyHold();
        return;
      }
    } else {
      startPunishLoop(config.intensity, 2000);
      prisonPenaltyHoldRemaining = 5.0;
      setUnifiedGameState(
        "punish",
        "PENALTY ACTIVE: FIRING EVERY 2s!",
        "ENGAGE SENSOR & HOLD DEEP FOR 5.0s TO STOP FEEDBACK!"
      );
    }
    updatePrisonArenaReadout();
    return;
  }

  const stage = pendingPrisonAssignment.stages[prisonStageIdx];
  if (!stage) return;

  if (prisonStagePrepRemaining > 0) {
    prisonStagePrepRemaining = Math.max(0, Math.round((prisonStagePrepRemaining - 0.1) * 10) / 10);
    updatePrisonArenaReadout();
    if (prisonStagePrepRemaining <= 0) {
      playTone(540, 100, "triangle");
      if (stage.type === "bpm") {
        startBpmPacer(stage.bpm, "prison-pacer-cue", "prison-arena", false);
      }
      // If next stage is a hold and player is already holding down when prep ends, lock in immediately!
      if (stage.type === "hold" && isPhysicalDown) {
        prisonHasStartedStage = true;
        prisonBreakSecElapsed = 0;
        prisonWaitingForBreakRelease = false;
        prisonHoldSetInProgress = true;
        setUnifiedGameState(
          "holding",
          "LOCKED IN HOLD — DO NOT RELEASE!",
          "Releasing before 0.0s immediately fails the task!"
        );
      } else {
        isRepStrokeArmed = !(config.inputSource === "mediapipe" && isPhysicalDown);
        setUnifiedGameState(
          "pause",
          stage.type === "bpm" ? "START TAPPING TO BEGIN" : "STAGE ARMED — ENGAGE SENSOR NOW!",
          stage.type === "bpm"
            ? `Follow the DOWN beat cue to match ${stage.bpm} BPM!`
            : `Engage within ${stage.maxBreakSec || 5}s to start Stage ${prisonStageIdx + 1}!`
        );
      }
      updatePrisonArenaReadout();
    }
    return;
  }

  if (!prisonHasStartedStage) {
    if (prisonStageIdx > 0) {
      const maxTransitionSec = stage.maxBreakSec > 0 ? stage.maxBreakSec : 5;
      prisonBreakSecElapsed += 0.1;
      const remTrans = Math.max(0, maxTransitionSec - prisonBreakSecElapsed);
      const delayBox = document.getElementById("prison-delay-box");
      const delayNum = document.getElementById("prison-delay-num");
      const delayFill = document.getElementById("prison-delay-fill");
      if (delayBox) delayBox.classList.remove("hidden");
      if (delayNum) delayNum.textContent = `${remTrans.toFixed(1)}s`;
      if (delayFill) delayFill.style.width = `${Math.min(100, (remTrans / maxTransitionSec) * 100)}%`;

      if (prisonBreakSecElapsed >= maxTransitionSec) {
        failPrisonTask(`Failed to start Stage ${prisonStageIdx + 1} within ${maxTransitionSec}s break limit!`);
        return;
      } else if (prisonBreakSecElapsed >= maxTransitionSec * 0.5) {
        setUnifiedGameState(
          "stalling",
          `START STAGE ${prisonStageIdx + 1} IN ${remTrans.toFixed(1)}s!`,
          isPhysicalDown
            ? "Release and re-engage sensor immediately for next stage!"
            : "Engage sensor immediately to start next stage!"
        );
      }
      updatePrisonArenaReadout();
    }
    return;
  }

  prisonStageTimeElapsed += 0.1;

  // Pulse Runner style BPM Cadence & Debt Engine
  if (stage.type === "bpm") {
    const now = Date.now();
    const cadenceWindowMs = Math.max(3500, (120000 / stage.bpm) + 500);
    prisonBpmTimestamps = prisonBpmTimestamps.filter(t => now - t <= cadenceWindowMs);

    prisonLiveBpm = 0;
    if (prisonBpmTimestamps.length >= 2) {
      const duration = (prisonBpmTimestamps[prisonBpmTimestamps.length - 1] - prisonBpmTimestamps[0]) / 1000;
      const count = prisonBpmTimestamps.length - 1;
      if (duration > 0) prisonLiveBpm = Math.round((count / duration) * 60);
    }

    prisonExpectedBeatFraction += stage.bpm / 600;
    prisonExpectedBeats = Math.floor(prisonExpectedBeatFraction);
    prisonBpmDebt = Math.max(0, prisonExpectedBeats - prisonRepsDone);

    const maxGraceSec = stage.maxBreakSec > 0 ? stage.maxBreakSec : 4;
    const delayBox = document.getElementById("prison-delay-box");
    const delayNum = document.getElementById("prison-delay-num");
    const delayFill = document.getElementById("prison-delay-fill");

    const inFirstBeatWindow = prisonBpmTimestamps.length === 1 &&
      (now - prisonBpmTimestamps[0]) <= ((60000 / stage.bpm) * 1.25);
    const isPaceCompliant = inFirstBeatWindow || prisonLiveBpm >= (stage.bpm * 0.85);

    if (isPaceCompliant) {
      prisonBreakSecElapsed = 0;
      if (delayBox) delayBox.classList.add("hidden");
      prisonBpmRemaining = Math.max(0, prisonBpmRemaining - 0.1);

      if (prisonBpmRemaining <= 0) {
        if (prisonBpmDebt > 0) {
          setUnifiedGameState(
            "holding",
            `CLEAR BEAT DEBT (${prisonBpmDebt} BEATS LEFT)!`,
            `Finish your remaining ${prisonBpmDebt} beats to complete the stage!`
          );
        } else {
          advanceOrCompletePrisonTask();
          return;
        }
      } else if (prisonBpmDebt > 0) {
        setUnifiedGameState("holding", `RECOVERING DEBT (${prisonBpmDebt} BEHIND)`, "Speed up past target tempo to pay off accumulated beats!");
      } else {
        setUnifiedGameState("holding", "RIGHT ON BEAT", `Maintain ${stage.bpm} BPM until timer reaches 0.0s.`);
      }
    } else {
      prisonBreakSecElapsed += 0.1;
      const remGrace = Math.max(0, maxGraceSec - prisonBreakSecElapsed);
      if (delayBox) delayBox.classList.remove("hidden");
      if (delayNum) delayNum.textContent = `${remGrace.toFixed(1)}s`;
      if (delayFill) delayFill.style.width = `${Math.min(100, (remGrace / maxGraceSec) * 100)}%`;

      setUnifiedGameState(
        "stalling",
        prisonBpmDebt > 0 ? `FASTER! DEBT: ${prisonBpmDebt} BEATS` : "FASTER! SPEED UP!",
        `Reach ${stage.bpm} BPM within ${remGrace.toFixed(1)}s or fail task!`
      );

      if (prisonBreakSecElapsed >= maxGraceSec) {
        failPrisonTask(`Dropped below ${stage.bpm} BPM pace for over ${maxGraceSec}s!`);
        return;
      }
    }

    updatePrisonArenaReadout();
    return;
  }

  // Check time limit failure (e.g. 150 reps in 2 min)
  if (stage.timeLimitSec && prisonStageTimeElapsed >= stage.timeLimitSec && prisonRepsDone < stage.targetReps) {
    failPrisonTask("Time limit expired before target reps were completed!");
    return;
  }

  const isActivelyProgressing = isPhysicalDown && (
    (stage.type === "hold" && !prisonWaitingForBreakRelease) ||
    (stage.type === "reps" && stage.minRepHoldSec > 0 && isRepStrokeArmed)
  );

  if (isActivelyProgressing) {
    prisonBreakSecElapsed = 0;
    const delayBox = document.getElementById("prison-delay-box");
    if (delayBox) delayBox.classList.add("hidden");

    if (stage.type === "reps" && stage.minRepHoldSec > 0 && isRepStrokeArmed) {
      prisonCurrentRepHoldSec += 0.1;
      if (prisonCurrentRepHoldSec >= stage.minRepHoldSec) {
        prisonRepsDone++;
        isRepStrokeArmed = false;
        prisonCurrentRepHoldSec = 0;
        playTone(720, 65, "sine");
        setUnifiedGameState("can-release", "REP LOCKED ✓ — RETRACT NOW", "Retract and re-engage for next deep rep.");
        if (prisonRepsDone >= stage.targetReps) {
          advanceOrCompletePrisonTask();
          return;
        }
      }
    } else if (stage.type === "hold") {
      prisonHoldSetInProgress = true;
      prisonHoldSecDone += 0.1;
      if (stage.cumulativeKey) {
        prisonState.cumulative[stage.cumulativeKey] = Math.round(prisonHoldSecDone * 10) / 10;
        if (Math.round(prisonHoldSecDone * 10) % 20 === 0) savePrisonState();
      }
      if (prisonHoldSecDone >= stage.holdSec) {
        playTone(840, 120, "sine");
        if (prisonSetIdx < (stage.sets || 1)) {
          prisonSetIdx++;
          prisonHoldSecDone = 0;
          prisonHoldSetInProgress = false;
          prisonWaitingForBreakRelease = true;
          prisonBreakSecElapsed = 0;
          setUnifiedGameState(
            "can-release",
            `SET ${prisonSetIdx - 1} CLEARED — RELEASE FOR BREAK!`,
            `Release and re-engage within ${stage.maxBreakSec || 5}s to start Set ${prisonSetIdx}.`
          );
        } else {
          advanceOrCompletePrisonTask();
          return;
        }
      }
    }
  } else {
    prisonBreakSecElapsed += 0.1;
    if (stage.maxBreakSec > 0) {
      const remBreak = Math.max(0, stage.maxBreakSec - prisonBreakSecElapsed);
      const delayBox = document.getElementById("prison-delay-box");
      const delayNum = document.getElementById("prison-delay-num");
      const delayFill = document.getElementById("prison-delay-fill");
      if (delayBox) delayBox.classList.remove("hidden");
      if (delayNum) delayNum.textContent = `${remBreak.toFixed(1)}s`;
      if (delayFill) delayFill.style.width = `${Math.min(100, (remBreak / stage.maxBreakSec) * 100)}%`;

      if (prisonBreakSecElapsed >= stage.maxBreakSec) {
        failPrisonTask(`Exceeded maximum break time (${stage.maxBreakSec}s)!`);
        return;
      } else if (prisonBreakSecElapsed >= stage.maxBreakSec * 0.5) {
        setUnifiedGameState(
          "stalling",
          `BREAK EXPIRING (${remBreak.toFixed(1)}s)!`,
          prisonWaitingForBreakRelease
            ? `Release and re-engage within ${remBreak.toFixed(1)}s for Set ${prisonSetIdx}!`
            : (isPhysicalDown && stage.type === "reps"
                ? `Retract and complete next rep within ${remBreak.toFixed(1)}s!`
                : "Engage sensor immediately or fail task!")
        );
      }
    }
  }

  updatePrisonArenaReadout();
}

function advanceOrCompletePrisonTask() {
  if (!pendingPrisonAssignment) return;
  if (prisonStageIdx + 1 < pendingPrisonAssignment.stages.length) {
    playTone(660, 120, "sine");
    setTimeout(() => playTone(880, 180, "sine"), 140);
    setupPrisonStage(prisonStageIdx + 1);
    return;
  }

  // All stages complete!
  stopPrisonGame();
  playTone(980, 260, "sine");
  sendRewardOnce("prison");

  const assign = pendingPrisonAssignment;
  prisonState.clearedCount++;
  let keepAssignmentLocked = false;

  if (assign.mode === "solitary") {
    const titleEl = document.getElementById("prison-roll-title");
    const descEl = document.getElementById("prison-roll-desc");
    const startBtn = document.getElementById("btn-prison-start-task");
    if (titleEl) titleEl.textContent = `✓ Solitary Task Cleared! Roll Again for Release`;
    if (descEl) descEl.textContent = "You completed the warden's task. Roll 1d6 again to try for a Release instruction.";
    if (startBtn) startBtn.classList.add("hidden");
  } else if (assign.isFinalRelease) {
    if (assign.roundKey && assign.roundsTotal > 1) {
      const done = (Number(prisonState.cumulative[assign.roundKey]) || 0) + 1;
      prisonState.cumulative[assign.roundKey] = done;
      if (done >= assign.roundsTotal) {
        prisonState.endingUnlocked = true;
      } else {
        keepAssignmentLocked = true;
      }
    } else {
      prisonState.endingUnlocked = true;
    }
    const titleEl = document.getElementById("prison-roll-title");
    const descEl = document.getElementById("prison-roll-desc");
    const startBtn = document.getElementById("btn-prison-start-task");
    if (prisonState.endingUnlocked) {
      if (titleEl) titleEl.textContent = "🎉 FINAL RELEASE TASK COMPLETED — ENDING UNLOCKED!";
      if (descEl) descEl.textContent = "Scroll down to read the Ending of Deepthroat Prison.";
      if (startBtn) startBtn.classList.add("hidden");
    } else {
      const done = prisonState.cumulative[assign.roundKey];
      if (titleEl) titleEl.textContent = `✓ Final Release Round ${done}/${assign.roundsTotal} Cleared!`;
      if (descEl) descEl.textContent = `Complete the remaining ${assign.roundsTotal - done} rounds to unlock your release.`;
    }
  } else {
    prisonState.points += assign.pts;
    const titleEl = document.getElementById("prison-roll-title");
    const descEl = document.getElementById("prison-roll-desc");
    const startBtn = document.getElementById("btn-prison-start-task");
    if (titleEl) titleEl.textContent = `✓ Task Cleared! +${assign.pts} PTS Earned`;
    if (descEl) descEl.textContent = `Total Points: ${prisonState.points} pts. Roll 1d6 for your next assignment.`;
    if (startBtn) startBtn.classList.add("hidden");
  }

  if (!keepAssignmentLocked) {
    pendingPrisonAssignment = null;
    prisonState.lastRoll = 0;
  }
  savePrisonState();
  switchScreen("hub");
  renderPrisonDashboard();
}

function startPrisonPenaltyHold(reason) {
  prisonPenaltyActive = true;
  prisonPenaltyReason = reason || "Task failed.";
  prisonPenaltyHoldRemaining = 5.0;
  prisonGameActive = true;

  stopBpmPacer();
  playTone(165, 450, "sawtooth");

  const pacerCue = document.getElementById("prison-pacer-cue");
  if (pacerCue) pacerCue.classList.add("hidden");
  const debtPill = document.getElementById("prison-debt-pill");
  if (debtPill) debtPill.classList.add("hidden");
  const delayBox = document.getElementById("prison-delay-box");
  if (delayBox) delayBox.classList.add("hidden");

  const forfeitBtn = document.getElementById("btn-prison-forfeit");
  if (forfeitBtn) {
    forfeitBtn.disabled = true;
    forfeitBtn.textContent = "Serving 5s Penalty Hold...";
  }

  if (isPhysicalDown) {
    stopPunishLoop();
    setUnifiedGameState(
      "holding",
      `PENALTY HOLD: ${prisonPenaltyHoldRemaining.toFixed(1)}s`,
      "FEEDBACK STOPPED — Keep holding deep for 5.0s unbroken to clear penalty!"
    );
  } else {
    startPunishLoop(config.intensity, 2000);
    setUnifiedGameState(
      "punish",
      "PENALTY ACTIVE: FIRING EVERY 2s!",
      "ENGAGE SENSOR & HOLD DEEP FOR 5.0s TO STOP FEEDBACK!"
    );
  }

  if (!prisonTicker) {
    prisonTicker = setInterval(tickPrisonArena, 100);
  }
  updatePrisonArenaReadout();
}

function finishPrisonPenaltyHold() {
  stopPunishLoop();
  playTone(540, 160, "triangle");
  setTimeout(() => playTone(720, 220, "sine"), 180);

  const reason = prisonPenaltyReason;
  prisonPenaltyActive = false;
  stopPrisonGame();

  const assign = pendingPrisonAssignment;
  prisonState.failedCount++;

  const titleEl = document.getElementById("prison-roll-title");
  const descEl = document.getElementById("prison-roll-desc");
  const startBtn = document.getElementById("btn-prison-start-task");

  if (assign) {
    if (assign.mode === "solitary") {
      // Cannot escape a solitary task by failing — keep it locked until completed!
      assign.failedLastAttempt = true;
      assign.lastFailReason = reason;
      savePrisonState();
      switchScreen("hub");
      renderPrisonDashboard();
      return;
    } else if (assign.isFinalRelease) {
      prisonState.points = Math.floor(prisonState.points / 2);
      prisonState.solitaryTier = "adv";
      prisonState.solitaryCount++;
      if (titleEl) titleEl.textContent = "Final Task Failed — Points Halved & Sent to Punishment Cell!";
      if (descEl) descEl.textContent = `${reason} Points halved to ${prisonState.points} pts and locked in Advanced Solitary.`;
    } else {
      prisonState.points = Math.max(0, prisonState.points - assign.pts);
      const targetSolitary = ["basic", "interm", "adv"].includes(assign.tierKey) ? assign.tierKey : "basic";
      prisonState.solitaryTier = targetSolitary;
      prisonState.solitaryCount++;
      if (titleEl) titleEl.textContent = `Task Failed! -${assign.pts} PTS & Sent to Punishment Cell!`;
      if (descEl) descEl.textContent = `${reason} Points reduced to ${prisonState.points} pts. Roll 1d6 in the Punishment Cell until released.`;
    }
  }
  if (startBtn) startBtn.classList.add("hidden");

  pendingPrisonAssignment = null;
  prisonState.lastRoll = 0;
  savePrisonState();
  switchScreen("hub");
  renderPrisonDashboard();
}

function failPrisonTask(reason) {
  if (prisonPenaltyActive) return;
  startPrisonPenaltyHold(reason);
}

function initPrisonCampaign() {
  const loreBtn = document.getElementById("btn-prison-toggle-lore");
  const lorePanel = document.getElementById("prison-lore-panel");
  if (loreBtn && lorePanel) {
    loreBtn.addEventListener("click", () => {
      const hidden = lorePanel.classList.toggle("hidden");
      loreBtn.textContent = hidden ? "Story & Rules ▾" : "Hide Story & Rules ▴";
    });
  }

  const rollSentenceBtn = document.getElementById("btn-prison-roll-sentence");
  if (rollSentenceBtn) {
    rollSentenceBtn.addEventListener("click", () => {
      const roll = Math.floor(Math.random() * 6) + 1;
      prisonState.sentenceRoll = roll;
      prisonState.targetPts = PRISON_SENTENCE_TABLE[roll];
      savePrisonState();
      playTone(680, 140, "sine");
      const diceFace = document.getElementById("prison-dice-face");
      const titleEl = document.getElementById("prison-roll-title");
      const descEl = document.getElementById("prison-roll-desc");
      if (diceFace) diceFace.textContent = `X=${roll}`;
      if (titleEl) titleEl.textContent = `Sentence Rolled (${roll}): ${prisonState.targetPts} Points Required!`;
      if (descEl) descEl.textContent = "Roll 1d6 below to receive your first task.";
      renderPrisonDashboard();
    });
  }

  const rollTaskBtn = document.getElementById("btn-prison-roll-task");
  if (rollTaskBtn) {
    rollTaskBtn.addEventListener("click", () => {
      if (pendingPrisonAssignment) return; // Strict no-reroll rule
      const roll = Math.floor(Math.random() * 6) + 1;
      playTone(540, 80, "triangle");
      if (prisonState.solitaryTier) {
        selectPrisonSolitaryRoll(roll);
      } else {
        selectPrisonNormalRoll(prisonState.selectedTier, roll);
      }
    });
  }

  const startTaskBtn = document.getElementById("btn-prison-start-task");
  if (startTaskBtn) {
    startTaskBtn.addEventListener("click", () => {
      if (!pendingPrisonAssignment) return;
      rewardSentForSession = false;
      switchScreen("game-prison");
    });
  }

  const forfeitBtn = document.getElementById("btn-prison-forfeit");
  if (forfeitBtn) {
    forfeitBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    forfeitBtn.addEventListener("click", () => {
      failPrisonTask("Task forfeited by prisoner.");
    });
  }

  const prisonArena = document.getElementById("prison-arena");
  if (prisonArena) {
    prisonArena.addEventListener("pointerdown", (e) => {
      if (e.target && e.target.closest && e.target.closest("#btn-prison-forfeit")) return;
      if (e && e.preventDefault) e.preventDefault();
      if (config.inputSource === "touch") handlePhysicalInputState(true);
    });
  }

  document.querySelectorAll(".prison-tier-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      if (pendingPrisonAssignment) {
        const titleEl = document.getElementById("prison-roll-title");
        const descEl = document.getElementById("prison-roll-desc");
        if (titleEl) titleEl.textContent = "Assignment Locked — No Rerolls Allowed";
        if (descEl) descEl.textContent = "You must complete or forfeit your current rolled task before changing tiers.";
        return;
      }
      const tier = btn.getAttribute("data-prison-tier");
      if (!isPrisonTierUnlocked(tier)) {
        const needed = tier === "interm" ? "60 pts" : (tier === "adv" ? "200 pts" : `${prisonState.targetPts || 550} pts`);
        const titleEl = document.getElementById("prison-roll-title");
        const descEl = document.getElementById("prison-roll-desc");
        if (titleEl) titleEl.textContent = `Tier Locked (${needed} required)`;
        if (descEl) descEl.textContent = `Earn ${needed} to unlock this tier.`;
        return;
      }
      prisonState.selectedTier = tier;
      savePrisonState();
      renderPrisonDashboard();
    });
  });

  const resetBtn = document.getElementById("btn-prison-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (!confirm("Reset your Deepthroat Prison sentence, points, and progress?")) return;
      prisonState = {
        points: 0,
        targetPts: 0,
        sentenceRoll: 0,
        selectedTier: "basic",
        solitaryTier: null,
        lastRoll: 0,
        clearedCount: 0,
        failedCount: 0,
        solitaryCount: 0,
        endingUnlocked: false,
        activeAssignment: null,
        cumulative: {}
      };
      pendingPrisonAssignment = null;
      savePrisonState();
      const diceFace = document.getElementById("prison-dice-face");
      const titleEl = document.getElementById("prison-roll-title");
      const descEl = document.getElementById("prison-roll-desc");
      if (diceFace) diceFace.textContent = "1D6";
      if (titleEl) titleEl.textContent = "Ready to Roll";
      if (descEl) descEl.textContent = "Select your unlocked tier below and roll 1d6 for your next assignment.";
      renderPrisonDashboard();
    });
  }

  renderPrisonDashboard();
}

// App Startup
window.addEventListener("DOMContentLoaded", () => {
  initHoldChallengeGame();
  initHoldDearLifeGame();
  initReachCountGame();
  initBpmGame();
  initTowerGame();
  initDtsGame();
  initBlindHiltGame();
  initTempoEscalationGame();
  initBpmCueSelectors();
  initCameraSensor();
  initMediaPipeDepth();
  initAmbientLightSensor();
  initWebSocketSensor();
  initGamepadPolling();
  initSettingsPage();
  initSessionSharing();
  initPrisonCampaign();
});
