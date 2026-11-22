/**
 * 贪吃蛇示例应用 — 前端逻辑（无框架，纯 Vite + TS）。
 *
 * 游戏状态完全在前端维护；最高分缓存在 localStorage，排行榜通过 vico 注入的应用
 * API（`/api/apps/snake-demo/scores`）读写，该 API 由本应用自己的 Node SQLite 实现。
 */
import './style.css';

/** 棋盘格数与单格像素（canvas 逻辑坐标） */
const GRID = 24;
const CELL = 20;
const SIZE = GRID * CELL;
const API_BASE = '/api/apps/snake-demo';

type Status = 'idle' | 'running' | 'paused' | 'over';
type Vec = { x: number; y: number };

interface ScoreRow {
  id: number;
  name: string;
  score: number;
  created_at: number;
}

/** 安全获取 DOM 元素（元素缺失属于模板错误，直接抛错便于定位） */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const canvas = el<HTMLCanvasElement>('board');
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('canvas 2d context unavailable');

const scoreNode = el<HTMLElement>('score');
const bestNode = el<HTMLElement>('best');
const overlay = el<HTMLElement>('overlay');
const overlayTitle = el<HTMLElement>('overlay-title');
const overlayText = el<HTMLElement>('overlay-text');
const startBtn = el<HTMLButtonElement>('start-btn');
const leaderboardNode = el<HTMLOListElement>('leaderboard');
const nameInput = el<HTMLInputElement>('player-name');

/** 游戏状态 */
let status: Status = 'idle';
let snake: Vec[] = [];
let direction: Vec = { x: 1, y: 0 };
let pendingDirection: Vec | null = null;
let apple: Vec = { x: 0, y: 0 };
let score = 0;
let best = Number(localStorage.getItem('snake_best') ?? 0);
let submitted = false;
let accumulator = 0;
let lastFrame = 0;

bestNode.textContent = String(best);
nameInput.value = localStorage.getItem('snake_player') ?? '';

/** 将 canvas 适配高分屏（逻辑坐标保持 480x480） */
function setupCanvas(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

setupCanvas();

/** 当前移动间隔（吃得越多越快） */
function tickInterval(): number {
  return Math.max(70, 132 - Math.floor(score / 10) * 4);
}

/** 重置一局 */
function reset(): void {
  const mid = Math.floor(GRID / 2);
  snake = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
  direction = { x: 1, y: 0 };
  pendingDirection = null;
  score = 0;
  submitted = false;
  scoreNode.textContent = '0';
  spawnApple();
  draw();
}

/** 在空白格随机生成苹果 */
function spawnApple(): void {
  const free: Vec[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!snake.some((s) => s.x === x && s.y === y)) free.push({ x, y });
    }
  }
  apple = free[Math.floor(Math.random() * free.length)] ?? { x: 0, y: 0 };
}

/** 开始游戏 */
function start(): void {
  reset();
  status = 'running';
  overlay.classList.add('hidden');
  lastFrame = performance.now();
  accumulator = 0;
  requestAnimationFrame(loop);
}

/** 结束游戏并提交分数 */
function gameOver(): void {
  status = 'over';
  overlay.classList.remove('hidden');
  overlayTitle.textContent = '游戏结束';
  overlayText.textContent = `本局得分 ${score} 分${score > 0 ? '，正在提交排行榜…' : '。'}按「再来一局」继续。`;
  startBtn.textContent = '再来一局';

  if (score > best) {
    best = score;
    localStorage.setItem('snake_best', String(best));
    bestNode.textContent = String(best);
  }
  if (score > 0 && !submitted) {
    submitted = true;
    void submitScore(score);
  }
}

/** 单步推进 */
function step(): void {
  if (pendingDirection && pendingDirection.x !== -direction.x && pendingDirection.y !== -direction.y) {
    direction = pendingDirection;
  }
  pendingDirection = null;

  const head = snake[0];
  const next: Vec = { x: head.x + direction.x, y: head.y + direction.y };

  // 撞墙
  if (next.x < 0 || next.y < 0 || next.x >= GRID || next.y >= GRID) {
    gameOver();
    return;
  }
  // 咬到自己（尾巴当前格在本次移动后会空出，允许进入）
  const body = snake.slice(0, snake.length - 1);
  if (body.some((s) => s.x === next.x && s.y === next.y)) {
    gameOver();
    return;
  }

  snake.unshift(next);
  if (next.x === apple.x && next.y === apple.y) {
    score += 10;
    scoreNode.textContent = String(score);
    spawnApple();
  } else {
    snake.pop();
  }
}

/** 帧循环 — 用时间累加器控制步频，渲染与步进解耦 */
function loop(now: number): void {
  if (status !== 'running') return;
  const delta = Math.min(now - lastFrame, 200);
  lastFrame = now;
  accumulator += delta;

  const interval = tickInterval();
  while (accumulator >= interval) {
    accumulator -= interval;
    step();
    if (status !== 'running') break;
  }
  draw();
  if (status === 'running') requestAnimationFrame(loop);
}

/** 圆角矩形绘制 */
function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 绘制整个棋盘 */
function draw(): void {
  // 背景 + 网格
  ctx.fillStyle = '#0c121c';
  ctx.fillRect(0, 0, SIZE, SIZE);

  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.018)';
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  // 苹果
  const acx = apple.x * CELL + CELL / 2;
  const acy = apple.y * CELL + CELL / 2;
  const glow = ctx.createRadialGradient(acx, acy, 1, acx, acy, CELL * 0.9);
  glow.addColorStop(0, 'rgba(255,107,122,0.55)');
  glow.addColorStop(1, 'rgba(255,107,122,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(acx, acy, CELL * 0.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff6b7a';
  ctx.beginPath();
  ctx.arc(acx, acy, CELL * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.arc(acx - CELL * 0.1, acy - CELL * 0.12, CELL * 0.1, 0, Math.PI * 2);
  ctx.fill();

  // 蛇身
  snake.forEach((segment, index) => {
    const isHead = index === 0;
    const t = index / Math.max(snake.length, 1);
    const x = segment.x * CELL + 2;
    const y = segment.y * CELL + 2;
    const s = CELL - 4;

    ctx.fillStyle = isHead
      ? '#8bf7c9'
      : `rgb(${Math.round(60 + 20 * t)}, ${Math.round(206 - 60 * t)}, ${Math.round(150 - 10 * t)})`;
    roundRect(x, y, s, s, isHead ? 7 : 5);
    ctx.fill();

    if (isHead) {
      // 眼睛随方向偏移
      const eyeOffset = 3.5;
      const fwdX = direction.x * 2;
      const fwdY = direction.y * 2;
      const eye1 = { x: x + s / 2 - (direction.y ? eyeOffset : 0) + fwdX, y: y + s / 2 - (direction.x ? eyeOffset : 0) + fwdY };
      const eye2 = { x: x + s / 2 + (direction.y ? eyeOffset : 0) + fwdX, y: y + s / 2 + (direction.x ? eyeOffset : 0) + fwdY };
      ctx.fillStyle = '#062218';
      ctx.beginPath();
      ctx.arc(eye1.x, eye1.y, 2.2, 0, Math.PI * 2);
      ctx.arc(eye2.x, eye2.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** 排行榜渲染 */
function renderLeaderboard(rows: ScoreRow[]): void {
  leaderboardNode.replaceChildren();
  if (rows.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '还没有记录，抢下第一名吧';
    leaderboardNode.append(li);
    return;
  }

  rows.slice(0, 10).forEach((row, index) => {
    const li = document.createElement('li');
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(index + 1);
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = row.name || '匿名玩家';
    const pts = document.createElement('span');
    pts.className = 'score';
    pts.textContent = String(row.score);
    li.append(rank, name, pts);
    leaderboardNode.append(li);
  });
}

/** 拉取排行榜（应用 API 不可用时展示提示） */
async function loadLeaderboard(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/scores`, { credentials: 'include' });
    if (!res.ok) throw new Error(String(res.status));
    renderLeaderboard((await res.json()) as ScoreRow[]);
  } catch {
    leaderboardNode.replaceChildren();
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '排行榜暂不可用';
    leaderboardNode.append(li);
  }
}

/** 提交分数到应用自己的后端 */
async function submitScore(value: number): Promise<void> {
  const name = nameInput.value.trim();
  localStorage.setItem('snake_player', name);
  try {
    const res = await fetch(`${API_BASE}/scores`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, score: value }),
    });
    if (!res.ok) throw new Error(String(res.status));
    const rows = (await res.json()) as ScoreRow[];
    renderLeaderboard(rows);
  } catch {
    overlayText.textContent = `本局得分 ${value} 分（提交失败，请确认应用已安装启用）。`;
  }
}

/** 方向键/字母键映射 */
const KEY_DIRS: Record<string, Vec> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

window.addEventListener('keydown', (event) => {
  if (event.key === ' ') {
    event.preventDefault();
    if (status === 'running') {
      status = 'paused';
      overlay.classList.remove('hidden');
      overlayTitle.textContent = '已暂停';
      overlayText.textContent = '按空格或点击下方按钮继续。';
      startBtn.textContent = '继续';
    } else if (status === 'paused') {
      resume();
    }
    return;
  }
  if (event.key === 'r' || event.key === 'R') {
    start();
    return;
  }

  const dir = KEY_DIRS[event.key] ?? KEY_DIRS[event.key.toLowerCase()];
  if (dir) {
    event.preventDefault();
    pendingDirection = dir;
  }
});

/** 从暂停恢复 */
function resume(): void {
  status = 'running';
  overlay.classList.add('hidden');
  lastFrame = performance.now();
  accumulator = 0;
  requestAnimationFrame(loop);
}

startBtn.addEventListener('click', () => {
  if (status === 'paused') {
    resume();
    return;
  }
  start();
});

// 触屏滑动
let touchStart: Vec | null = null;
canvas.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
  pendingDirection = Math.abs(dx) > Math.abs(dy)
    ? { x: dx > 0 ? 1 : -1, y: 0 }
    : { x: 0, y: dy > 0 ? 1 : -1 };
}, { passive: true });

reset();
void loadLeaderboard();
