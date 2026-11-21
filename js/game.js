import { SnakeGame, DIRECTIONS } from "./core.js";
import { SoundEngine } from "./audio.js";

/* =========================================================
   Config & storage
   ========================================================= */

const GRID = 24;
const MODES = {
  classic: { label: "CLASSIC", wrap: false, title: "经典模式" },
  wrap: { label: "WRAP", wrap: true, title: "穿墙模式" },
};

const STORAGE = {
  mode: "neon-snake.mode",
  muted: "neon-snake.muted",
  best: (mode) => `neon-snake.best.${mode}`,
};

const storage = {
  get(key, fallback = null) {
    try {
      const value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch {
      /* private mode / disabled storage */
    }
  },
};

/* =========================================================
   DOM
   ========================================================= */

const $ = (selector) => document.querySelector(selector);

const canvas = $("#game");
const ctx = canvas.getContext("2d");
const stage = $("#stage");
const overlay = $("#overlay");

const scoreEl = $("#score");
const bestEl = $("#best");
const modeLabelEl = $("#modeLabel");
const pauseBtn = $("#pauseBtn");
const soundBtn = $("#soundBtn");
const statusPill = $("#statusPill");
const statusText = $("#statusText");
const liveRegion = $("#liveRegion");

const finalScoreEl = $("#finalScore");
const finalBestEl = $("#finalBest");
const recordBadge = $("#recordBadge");
const overReasonEl = $("#overReason");
const overTitleEl = $("#overTitle");
const overEyebrowEl = $("#overEyebrow");

const lengthStatEl = $("#lengthStat");
const levelStatEl = $("#levelStat");
const eatenStatEl = $("#eatenStat");
const speedFillEl = $("#speedFill");
const speedLabelEl = $("#speedLabel");

const modeButtons = [...document.querySelectorAll(".mode-btn")];

/* =========================================================
   State
   ========================================================= */

let mode = MODES[storage.get(STORAGE.mode, "classic")] ? storage.get(STORAGE.mode, "classic") : "classic";
let muted = storage.get(STORAGE.muted, "0") === "1";
const sound = new SoundEngine({ muted });

let game = createGame();
let state = "ready"; // ready | running | paused | over | won
let bestAtStart = getBest(mode);
let newRecord = false;
let deathReason = "wall";

let prevSnake = snapshotSnake();
let accumulator = 0;
let tickProgress = 0;
let lastFrameAt = performance.now();
let deathAt = 0;
let shake = 0;
let particles = [];
let overTimer = 0;
let scorePopTimer = 0;

const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/* =========================================================
   Helpers
   ========================================================= */

function createGame() {
  return new SnakeGame({ cols: GRID, rows: GRID, wrap: MODES[mode].wrap });
}

function snapshotSnake() {
  return game.snake.map((segment) => ({ ...segment }));
}

function getBest(forMode = mode) {
  const value = Number.parseInt(storage.get(STORAGE.best(forMode), "0"), 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function setBest(value) {
  storage.set(STORAGE.best(mode), value);
}

function announce(message) {
  liveRegion.textContent = "";
  window.setTimeout(() => {
    liveRegion.textContent = message;
  }, 30);
}

function setStatus(label, live = false) {
  statusText.textContent = label;
  statusPill.classList.toggle("is-live", live);
}

function setScreen(screen) {
  overlay.dataset.screen = screen;
  const hidden = screen === "play";
  overlay.setAttribute("aria-hidden", String(hidden));
  pauseBtn.disabled = state !== "running";
}

/* =========================================================
   HUD
   ========================================================= */

function updateHud({ popScore = false } = {}) {
  const liveBest = Math.max(getBest(mode), game.score);
  scoreEl.textContent = String(game.score);
  bestEl.textContent = String(liveBest);
  modeLabelEl.textContent = MODES[mode].label;

  lengthStatEl.textContent = String(game.length);
  levelStatEl.textContent = String(game.level);
  eatenStatEl.textContent = String(game.eaten);
  speedFillEl.style.width = `${Math.min(100, 8 + game.eaten * 4.2)}%`;
  speedLabelEl.textContent = `${game.speed.toFixed(1)}×`;

  if (popScore) {
    scoreEl.classList.remove("is-popping");
    // Force a reflow so the animation can restart on rapid eats.
    void scoreEl.offsetWidth;
    scoreEl.classList.add("is-popping");
    window.clearTimeout(scorePopTimer);
    scorePopTimer = window.setTimeout(() => scoreEl.classList.remove("is-popping"), 340);
  }
}

function syncModeUi() {
  modeLabelEl.textContent = MODES[mode].label;
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
  updateHud();
}

function syncSoundUi() {
  soundBtn.classList.toggle("is-muted", muted);
  soundBtn.setAttribute("aria-pressed", String(muted));
  soundBtn.setAttribute("aria-label", muted ? "开启音效" : "关闭音效");
}

/* =========================================================
   Game flow
   ========================================================= */

function startGame() {
  window.clearTimeout(overTimer);
  overTimer = 0;

  game = createGame();
  bestAtStart = getBest(mode);
  newRecord = false;
  deathReason = "wall";
  prevSnake = snapshotSnake();
  particles = [];
  accumulator = 0;
  tickProgress = 0;
  shake = 0;
  deathAt = 0;

  state = "running";
  stage.classList.remove("is-dead");
  pauseBtn.disabled = false;
  setScreen("play");
  syncModeUi();
  updateHud();
  setStatus("运行中", true);
  sound.start();
  announce("游戏开始");
  stage.focus({ preventScroll: true });
  lastFrameAt = performance.now();
}

function pauseGame() {
  if (state !== "running") return;
  state = "paused";
  accumulatedPause();
  setScreen("pause");
  setStatus("已暂停", false);
  sound.pause();
  announce("游戏已暂停");
}

function resumeGame() {
  if (state !== "paused") return;
  state = "running";
  setScreen("play");
  setStatus("运行中", true);
  accumulator = 0;
  lastFrameAt = performance.now();
  sound.unlock();
  sound.click();
  announce("继续游戏");
  stage.focus({ preventScroll: true });
}

function accumulatedPause() {
  tickProgress = Math.min(accumulator / game.stepMs, 1);
}

function goToMenu() {
  window.clearTimeout(overTimer);
  overTimer = 0;
  state = "ready";
  game = createGame();
  prevSnake = snapshotSnake();
  particles = [];
  accumulator = 0;
  tickProgress = 0;
  shake = 0;
  deathAt = 0;
  stage.classList.remove("is-dead");
  setScreen("start");
  syncModeUi();
  setStatus("待机", false);
  sound.click();
  announce("回到主菜单");
  $("#startBtn").focus({ preventScroll: true });
}

function chooseMode(nextMode) {
  if (!MODES[nextMode] || nextMode === mode) return;
  if (state === "running" || state === "paused") return;

  mode = nextMode;
  storage.set(STORAGE.mode, mode);
  game = createGame();
  bestAtStart = getBest(mode);
  prevSnake = snapshotSnake();
  accumulator = 0;
  tickProgress = 0;
  particles = [];
  syncModeUi();
  setStatus("待机", false);
  sound.unlock();
  sound.click();
  announce(`已选择${MODES[mode].title}`);
}

function finishGame(type) {
  const won = type === "win";
  state = won ? "won" : "over";
  deathAt = performance.now();
  pauseBtn.disabled = true;
  stage.classList.add("is-dead");

  const previousBest = getBest(mode);
  newRecord = game.score > previousBest;
  if (newRecord) setBest(game.score);
  bestAtStart = Math.max(previousBest, game.score);

  if (won) {
    sound.win();
    setStatus("完成", false);
    overEyebrowEl.innerHTML = "BOARD <span>//</span> CLEAR";
    overTitleEl.textContent = "PERFECT RUN";
    overReasonEl.textContent = "整块棋盘都被你填满了，这就是霓虹的极限。";
    announce(`完美通关，得分 ${game.score}`);
    burstAt(game.head.x, game.head.y, { count: 46, colors: ["#7dffc4", "#22d3ee", "#ffffff"], power: 1.4 });
  } else {
    sound.die();
    shake = reducedMotion ? 0 : 14;
    setStatus("信号中断", false);
    overEyebrowEl.innerHTML = "SIGNAL <span>//</span> LOST";
    overTitleEl.textContent = "GAME OVER";
    overReasonEl.textContent = deathReason === "self"
      ? "你咬到了自己。别把身体拧成死结。"
      : "你撞上了边界。提前一格转弯会更安全。";
    announce(`游戏结束，得分 ${game.score}${newRecord ? "，新纪录" : ""}`);
    burstAt(game.head.x, game.head.y, { count: reducedMotion ? 12 : 34, colors: ["#ff3ea5", "#ff4664", "#ffb0c4"], power: 1.2 });
  }

  finalScoreEl.textContent = String(game.score);
  finalBestEl.textContent = String(bestAtStart);
  recordBadge.hidden = !newRecord || game.score === 0;
  updateHud();

  overTimer = window.setTimeout(() => {
    if (state === "over" || state === "won") setScreen("over");
  }, reducedMotion ? 120 : 620);
}

/* =========================================================
   Input
   ========================================================= */

const KEY_TO_DIR = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

function handleDirection(direction) {
  if (state === "ready" || state === "over" || state === "won") {
    startGame();
    game.turn(direction);
    return;
  }
  if (state === "running") {
    game.turn(direction);
  }
}

function toggleMute() {
  muted = !muted;
  storage.set(STORAGE.muted, muted ? "1" : "0");
  sound.setMuted(muted);
  syncSoundUi();
  if (!muted) {
    sound.unlock();
    sound.click();
  }
  announce(muted ? "音效已关闭" : "音效已开启");
}

function onKeyDown(event) {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;

  const tag = event.target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

  // Let focused buttons/links handle their own Space/Enter activation.
  const isButton = tag === "BUTTON" || tag === "A";
  if (isButton && (event.key === " " || event.key === "Enter")) return;

  const direction = KEY_TO_DIR[event.code];
  if (direction) {
    event.preventDefault();
    handleDirection(direction);
    return;
  }

  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    if (state === "running") pauseGame();
    else if (state === "paused") resumeGame();
    else if (state === "ready" || state === "over" || state === "won") startGame();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    if (state === "paused") resumeGame();
    else if (state !== "running") startGame();
    return;
  }

  if (event.key === "Escape") {
    if (state === "running") pauseGame();
    else if (state === "paused") resumeGame();
    return;
  }

  if (event.key === "m" || event.key === "M") {
    event.preventDefault();
    toggleMute();
  }
}

/* --- swipe --- */
let pointerStart = null;

stage.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
});

stage.addEventListener("pointerup", (event) => {
  if (!pointerStart || pointerStart.id !== event.pointerId) {
    pointerStart = null;
    return;
  }
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  pointerStart = null;

  if (Math.max(Math.abs(dx), Math.abs(dy)) < 22) return;
  const direction = Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? "right" : "left")
    : (dy > 0 ? "down" : "up");
  handleDirection(direction);
});

stage.addEventListener("pointercancel", () => {
  pointerStart = null;
});

/* --- buttons --- */
for (const button of modeButtons) {
  button.addEventListener("click", () => chooseMode(button.dataset.mode));
}

$("#startBtn").addEventListener("click", startGame);
$("#restartBtn").addEventListener("click", startGame);
$("#resumeBtn").addEventListener("click", resumeGame);
$("#pauseMenuBtn").addEventListener("click", goToMenu);
$("#menuBtn").addEventListener("click", goToMenu);
soundBtn.addEventListener("click", toggleMute);
pauseBtn.addEventListener("click", () => {
  if (state === "running") pauseGame();
});

for (const button of document.querySelectorAll(".dpad")) {
  button.addEventListener("click", () => handleDirection(button.dataset.dir));
}

document.addEventListener("keydown", onKeyDown);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && state === "running") pauseGame();
});

/* =========================================================
   Canvas
   ========================================================= */

let view = { w: 0, h: 0, dpr: 1 };
let cell = 0;
let boardX = 0;
let boardY = 0;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelWidth = Math.round(rect.width * dpr);
  const pixelHeight = Math.round(rect.height * dpr);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view = { w: rect.width, h: rect.height, dpr };
  cell = Math.min(rect.width / GRID, rect.height / GRID);
  boardX = (rect.width - cell * GRID) / 2;
  boardY = (rect.height - cell * GRID) / 2;
}

function centerOf(gridX, gridY) {
  return {
    x: boardX + (gridX + 0.5) * cell,
    y: boardY + (gridY + 0.5) * cell,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function roundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawBackground(now) {
  const { w, h } = view;
  const gradient = ctx.createRadialGradient(w * 0.5, h * 0.42, cell * 0.5, w * 0.5, h * 0.5, w * 0.78);
  gradient.addColorStop(0, "#0a1730");
  gradient.addColorStop(0.55, "#060c1b");
  gradient.addColorStop(1, "#03050d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  // Breathing glow in the corners.
  const pulse = 0.5 + Math.sin(now * 0.00035) * 0.5;
  const cyanGlow = ctx.createRadialGradient(w * 0.14, h * 0.16, 0, w * 0.14, h * 0.16, w * 0.5);
  cyanGlow.addColorStop(0, `rgba(34, 211, 238, ${0.055 + pulse * 0.025})`);
  cyanGlow.addColorStop(1, "rgba(34, 211, 238, 0)");
  ctx.fillStyle = cyanGlow;
  ctx.fillRect(0, 0, w, h);

  const pinkGlow = ctx.createRadialGradient(w * 0.92, h * 0.9, 0, w * 0.92, h * 0.9, w * 0.42);
  pinkGlow.addColorStop(0, "rgba(255, 62, 165, 0.045)");
  pinkGlow.addColorStop(1, "rgba(255, 62, 165, 0)");
  ctx.fillStyle = pinkGlow;
  ctx.fillRect(0, 0, w, h);

  // Grid.
  ctx.save();
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID; i += 1) {
    const major = i % 6 === 0;
    ctx.strokeStyle = major ? "rgba(95, 216, 255, 0.10)" : "rgba(95, 190, 255, 0.045)";
    const x = Math.round(boardX + i * cell) + 0.5;
    const y = Math.round(boardY + i * cell) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, boardY);
    ctx.lineTo(x, boardY + GRID * cell);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(boardX, y);
    ctx.lineTo(boardX + GRID * cell, y);
    ctx.stroke();
  }

  // Board edge.
  ctx.strokeStyle = "rgba(34, 211, 238, 0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(boardX + 0.5, boardY + 0.5, GRID * cell - 1, GRID * cell - 1);
  ctx.restore();
}

function drawFood(now) {
  if (!game.food) return;
  const { x, y } = centerOf(game.food.x, game.food.y);
  const pulse = 1 + Math.sin(now * 0.0048) * 0.09;
  const radius = cell * 0.29 * pulse;

  ctx.save();
  ctx.translate(x, y);

  // Halo.
  const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.75);
  halo.addColorStop(0, "rgba(255, 62, 165, 0.32)");
  halo.addColorStop(0.45, "rgba(255, 62, 165, 0.1)");
  halo.addColorStop(1, "rgba(255, 62, 165, 0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, cell * 0.75, 0, Math.PI * 2);
  ctx.fill();

  // Orbiting ring.
  ctx.save();
  ctx.rotate(now * 0.0014);
  ctx.strokeStyle = "rgba(255, 150, 210, 0.45)";
  ctx.lineWidth = Math.max(1, cell * 0.045);
  ctx.beginPath();
  ctx.arc(0, 0, cell * 0.47, -0.2, Math.PI * 1.15);
  ctx.stroke();
  ctx.restore();

  // Core.
  const orb = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, radius * 0.05, 0, 0, radius);
  orb.addColorStop(0, "#ffffff");
  orb.addColorStop(0.28, "#ffd4ec");
  orb.addColorStop(0.68, "#ff58b4");
  orb.addColorStop(1, "#e3007b");
  ctx.shadowColor = "#ff3ea5";
  ctx.shadowBlur = cell * 0.9;
  ctx.fillStyle = orb;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();

  // Sparkle cross.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = Math.max(1, cell * 0.03);
  ctx.beginPath();
  ctx.moveTo(-cell * 0.16, 0);
  ctx.lineTo(cell * 0.16, 0);
  ctx.moveTo(0, -cell * 0.16);
  ctx.lineTo(0, cell * 0.16);
  ctx.stroke();

  ctx.restore();
}

function getSnakePoints(t) {
  return game.snake.map((segment, index) => {
    const previous = prevSnake[index];
    let gx = segment.x;
    let gy = segment.y;

    // Only interpolate normal one-cell moves. Wrap jumps and newly grown
    // segments snap to their cell so no line is drawn across the board.
    if (previous) {
      const dx = Math.abs(segment.x - previous.x);
      const dy = Math.abs(segment.y - previous.y);
      if (dx <= 1 && dy <= 1) {
        gx = lerp(previous.x, segment.x, t);
        gy = lerp(previous.y, segment.y, t);
      }
    }

    return centerOf(gx, gy);
  });
}

function strokeSnakePath(points) {
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    const previous = points[i - 1];
    if (!started) {
      ctx.moveTo(point.x, point.y);
      started = true;
    } else if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > cell * 1.8) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  }
  ctx.stroke();
}

function drawSnake(t, now) {
  if (game.snake.length === 0) return;
  const points = getSnakePoints(t);
  const head = points[0];
  const tail = points[points.length - 1];
  const dying = state === "over";

  const headColor = dying ? "#ffc2cb" : "#c9ffe8";
  const midColor = dying ? "#ff4664" : "#2ee6d2";
  const tailColor = dying ? "#5b0f1c" : "#7c3aed";

  // Soft outer glow.
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = dying ? "rgba(255, 70, 100, 0.18)" : "rgba(34, 211, 238, 0.2)";
  ctx.lineWidth = cell * 0.98;
  ctx.shadowColor = dying ? "#ff2d55" : "#22d3ee";
  ctx.shadowBlur = cell * 1.05;
  strokeSnakePath(points);

  // Body.
  const gradient = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y);
  gradient.addColorStop(0, headColor);
  gradient.addColorStop(0.38, midColor);
  gradient.addColorStop(1, tailColor);
  ctx.strokeStyle = gradient;
  ctx.lineWidth = cell * 0.64;
  ctx.shadowBlur = cell * 0.55;
  strokeSnakePath(points);

  // Top highlight.
  ctx.strokeStyle = dying ? "rgba(255, 255, 255, 0.16)" : "rgba(255, 255, 255, 0.22)";
  ctx.lineWidth = cell * 0.16;
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.7;
  strokeSnakePath(points);
  ctx.globalAlpha = 1;

  // Segment scale texture.
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    ctx.fillStyle = dying ? "rgba(255, 120, 140, 0.28)" : `rgba(170, 255, 240, ${0.2 + Math.sin(now * 0.004 + i) * 0.08})`;
    ctx.beginPath();
    ctx.arc(point.x, point.y, cell * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }

  // Head.
  const headRadius = cell * 0.4;
  const headGradient = ctx.createRadialGradient(
    head.x - headRadius * 0.35,
    head.y - headRadius * 0.4,
    headRadius * 0.08,
    head.x,
    head.y,
    headRadius,
  );
  headGradient.addColorStop(0, "#ffffff");
  headGradient.addColorStop(0.35, dying ? "#ffd2d8" : "#d5fff0");
  headGradient.addColorStop(1, dying ? "#ff4664" : "#59f0d0");
  ctx.fillStyle = headGradient;
  ctx.shadowColor = dying ? "#ff2d55" : "#7dffc4";
  ctx.shadowBlur = cell * 0.6;
  ctx.beginPath();
  ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Eyes, oriented to the current direction.
  const dir = DIRECTIONS[game.direction];
  const fx = dir.x;
  const fy = dir.y;
  const px = -fy;
  const py = fx;
  const eyeForward = cell * 0.1;
  const eyeSide = cell * 0.15;
  const eyeRadius = Math.max(1.5, cell * 0.085);

  for (const side of [-1, 1]) {
    const ex = head.x + fx * eyeForward + px * eyeSide * side;
    const ey = head.y + fy * eyeForward + py * eyeSide * side;
    ctx.fillStyle = "#04121c";
    ctx.beginPath();
    ctx.arc(ex, ey, eyeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ecffff";
    ctx.beginPath();
    ctx.arc(ex - eyeRadius * 0.28, ey - eyeRadius * 0.28, eyeRadius * 0.34, 0, Math.PI * 2);
    ctx.fill();
  }

  // Tiny nose accent.
  ctx.fillStyle = dying ? "rgba(255, 200, 210, 0.7)" : "rgba(230, 255, 250, 0.85)";
  ctx.beginPath();
  ctx.arc(head.x + fx * cell * 0.27, head.y + fy * cell * 0.27, Math.max(1, cell * 0.035), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* =========================================================
   Particles
   ========================================================= */

function burstAt(gridX, gridY, { count = 18, colors = ["#ff3ea5", "#ff8fc8", "#ffffff"], power = 1 } = {}) {
  if (!cell) return;
  const origin = centerOf(gridX, gridY);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (45 + Math.random() * 190) * power;
    const maxLife = 0.35 + Math.random() * 0.55;
    particles.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 20,
      life: maxLife,
      maxLife,
      size: Math.max(1, (0.7 + Math.random() * 2.1) * (cell / 27)),
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  if (particles.length > 180) particles.splice(0, particles.length - 180);
}

function updateParticles(dtMs) {
  const dt = Math.min(dtMs, 42) / 1000;
  if (dt <= 0) return;
  for (const particle of particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 210 * dt;
    particle.vx *= 0.988;
  }
  particles = particles.filter((particle) => particle.life > 0);
}

function drawParticles() {
  if (particles.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const particle of particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (0.5 + alpha * 0.7), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* =========================================================
   Simulation
   ========================================================= */

function performStep() {
  const before = snapshotSnake();
  const event = game.step();
  prevSnake = before;

  if (event.type === "eat") {
    burstAt(event.head.x, event.head.y, { count: reducedMotion ? 8 : 18 });
    shake = reducedMotion ? 0 : 2.6;
    updateHud({ popScore: true });
    sound.eat();
    if (game.eaten % 4 === 0) announce(`等级 ${game.level}，速度提升`);
  } else if (event.type === "die") {
    deathReason = event.reason ?? "wall";
    finishGame("die");
  } else if (event.type === "win") {
    finishGame("win");
  }
}

/* =========================================================
   Render loop
   ========================================================= */

function render(now, dt) {
  const { w, h } = view;
  if (!w || !h) return;

  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawBackground(now);
  ctx.restore();

  const shakeX = shake > 0.2 ? (Math.random() * 2 - 1) * shake : 0;
  const shakeY = shake > 0.2 ? (Math.random() * 2 - 1) * shake : 0;

  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.translate(shakeX, shakeY);

  drawFood(now);

  const t = state === "running" ? tickProgress : 1;
  drawSnake(state === "paused" ? tickProgress : t, now);
  drawParticles();

  // Death / win flash.
  if ((state === "over" || state === "won") && deathAt > 0) {
    const age = (now - deathAt) / 560;
    if (age >= 0 && age < 1) {
      ctx.fillStyle = state === "won"
        ? `rgba(125, 255, 196, ${(1 - age) * 0.18})`
        : `rgba(255, 40, 80, ${(1 - age) * 0.24})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  ctx.restore();
  shake = Math.max(0, shake * 0.87);
}

function loop(now) {
  const dt = Math.min(now - lastFrameAt, 120);
  lastFrameAt = now;

  if (state === "running") {
    accumulator += dt;

    let steps = 0;
    while (accumulator >= game.stepMs && steps < 4) {
      accumulator -= game.stepMs;
      performStep();
      steps += 1;
      if (state !== "running") break;
    }

    tickProgress = state === "running" ? Math.min(accumulator / game.stepMs, 1) : 1;
  }

  if (state !== "paused") updateParticles(dt);
  render(now, dt);
  window.requestAnimationFrame(loop);
}

/* =========================================================
   Boot
   ========================================================= */

function boot() {
  syncModeUi();
  syncSoundUi();
  setStatus("待机", false);
  setScreen("start");
  resizeCanvas();
  updateHud();

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(resizeCanvas).observe(canvas);
  }
  window.addEventListener("resize", resizeCanvas, { passive: true });

  window.requestAnimationFrame((now) => {
    lastFrameAt = now;
    window.requestAnimationFrame(loop);
  });
}

boot();
