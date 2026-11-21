/**
 * NEON SNAKE — deterministic game simulation.
 *
 * This module is deliberately free of DOM / Canvas / browser APIs so the exact
 * same rules run in the browser and in `node --test`.
 */

export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1, name: "up" }),
  down: Object.freeze({ x: 0, y: 1, name: "down" }),
  left: Object.freeze({ x: -1, y: 0, name: "left" }),
  right: Object.freeze({ x: 1, y: 0, name: "right" }),
});

const OPPOSITE = Object.freeze({
  up: "down",
  down: "up",
  left: "right",
  right: "left",
});

export const BASE_STEP_MS = 152;
export const MIN_STEP_MS = 66;

/** Resolve a direction name such as "up" to its vector, or null. */
export function directionFromName(name) {
  return typeof name === "string" && Object.hasOwn(DIRECTIONS, name)
    ? DIRECTIONS[name]
    : null;
}

/**
 * @typedef {{ x: number, y: number }} Cell
 * @typedef {{ type: "move"|"eat"|"win"|"die", head?: Cell, food?: Cell|null, score?: number, reason?: "wall"|"self", wrapped?: boolean }} StepEvent
 */

export class SnakeGame {
  /**
   * @param {object} [options]
   * @param {number} [options.cols=24]
   * @param {number} [options.rows=24]
   * @param {boolean} [options.wrap=false] pass through the board edges
   * @param {number} [options.startLength=4]
   * @param {() => number} [options.rng=Math.random] injectable randomness (tests)
   */
  constructor({ cols = 24, rows = 24, wrap = false, startLength = 4, rng = Math.random } = {}) {
    if (!Number.isInteger(cols) || cols < 6) throw new RangeError("cols must be an integer >= 6");
    if (!Number.isInteger(rows) || rows < 6) throw new RangeError("rows must be an integer >= 6");
    if (!Number.isInteger(startLength) || startLength < 2) throw new RangeError("startLength must be >= 2");
    if (startLength > cols - 2) throw new RangeError("startLength does not fit on the board");
    if (typeof rng !== "function") throw new TypeError("rng must be a function");

    this.cols = cols;
    this.rows = rows;
    this.wrap = Boolean(wrap);
    this.startLength = startLength;
    this.rng = rng;

    this.reset();
  }

  /** Reset board, score and snake to the starting position. */
  reset() {
    const startY = Math.floor(this.rows / 2);
    const headX = Math.floor(this.cols / 2) + Math.floor((this.startLength - 1) / 2);

    /** @type {Cell[]} head first */
    this.snake = [];
    for (let i = 0; i < this.startLength; i += 1) {
      this.snake.push({ x: headX - i, y: startY });
    }

    /** @type {"up"|"down"|"left"|"right"} */
    this.direction = "right";
    /** @type {Cell[]} buffered turns, max 2 */
    this.turnQueue = [];
    /** @type {Cell|null} */
    this.food = null;
    this.score = 0;
    this.eaten = 0;
    this.alive = true;
    this.won = false;
    this.spawnFood();
  }

  get head() {
    return this.snake[0];
  }

  get length() {
    return this.snake.length;
  }

  /** Current food-derived level, starting at 1. */
  get level() {
    return 1 + Math.floor(this.eaten / 4);
  }

  /** Milliseconds between simulation ticks for the current speed. */
  get stepMs() {
    return Math.max(MIN_STEP_MS, BASE_STEP_MS - this.eaten * 4.6);
  }

  /** User-facing speed multiplier, e.g. 1, 1.2, 2.3. */
  get speed() {
    return Math.round((BASE_STEP_MS / this.stepMs) * 10) / 10;
  }

  /**
   * Queue a direction change. Reversing into yourself (180°) and duplicate
   * inputs are rejected. At most two turns may be buffered per tick.
   *
   * @param {string|{x:number,y:number}} input
   * @returns {boolean} whether the turn was accepted
   */
  turn(input) {
    const dir = typeof input === "string" ? directionFromName(input) : input;
    if (!dir || !Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return false;
    if (Math.abs(dir.x) + Math.abs(dir.y) !== 1) return false;

    const last = this.turnQueue.length > 0
      ? this.turnQueue[this.turnQueue.length - 1]
      : DIRECTIONS[this.direction];

    // No 180° reversals, no duplicate direction, max 2 buffered turns.
    if (dir.x === -last.x && dir.y === -last.y) return false;
    if (dir.x === last.x && dir.y === last.y) return false;
    if (this.turnQueue.length >= 2) return false;

    this.turnQueue.push({ x: dir.x, y: dir.y, name: dir.name });
    return true;
  }

  /** @param {number} x @param {number} y */
  isOccupied(x, y, { includeTail = true } = {}) {
    const body = includeTail ? this.snake : this.snake.slice(0, -1);
    return body.some((segment) => segment.x === x && segment.y === y);
  }

  /**
   * Place the next food orb on a uniformly random free cell.
   * @returns {Cell|null} null when the board is full
   */
  spawnFood() {
    const free = [];
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        if (!this.snake.some((segment) => segment.x === x && segment.y === y)) {
          free.push({ x, y });
        }
      }
    }

    if (free.length === 0) {
      this.food = null;
      this.won = true;
      return null;
    }

    const index = Math.min(free.length - 1, Math.floor(this.rng() * free.length));
    this.food = free[Math.max(0, index)];
    return this.food;
  }

  /**
   * Advance the simulation by one cell.
   * @returns {StepEvent}
   */
  step() {
    if (!this.alive) {
      return this.won ? { type: "win", score: this.score } : { type: "die", reason: "self" };
    }

    if (this.turnQueue.length > 0) {
      const next = this.turnQueue.shift();
      this.direction = next.name;
    }

    const dir = DIRECTIONS[this.direction];
    const currentHead = this.head;
    let nextX = currentHead.x + dir.x;
    let nextY = currentHead.y + dir.y;
    let wrapped = false;

    if (this.wrap) {
      const rawX = nextX;
      const rawY = nextY;
      nextX = (nextX + this.cols) % this.cols;
      nextY = (nextY + this.rows) % this.rows;
      wrapped = rawX !== nextX || rawY !== nextY;
    } else if (nextX < 0 || nextY < 0 || nextX >= this.cols || nextY >= this.rows) {
      this.alive = false;
      return { type: "die", reason: "wall", head: { x: nextX, y: nextY } };
    }

    const eating = Boolean(this.food && this.food.x === nextX && this.food.y === nextY);

    // When not growing, the tail cell is vacated on this same tick, so moving
    // into it is legal. When eating, the whole body stays put.
    const body = eating ? this.snake : this.snake.slice(0, -1);
    if (body.some((segment) => segment.x === nextX && segment.y === nextY)) {
      this.alive = false;
      return { type: "die", reason: "self", head: { x: nextX, y: nextY } };
    }

    const nextHead = { x: nextX, y: nextY };
    this.snake.unshift(nextHead);

    if (!eating) {
      this.snake.pop();
      return { type: "move", head: nextHead, wrapped };
    }

    this.eaten += 1;
    this.score += 10;
    const moreRoom = this.spawnFood() !== null;

    if (!moreRoom) {
      this.alive = false;
      return { type: "win", head: nextHead, score: this.score };
    }

    return {
      type: "eat",
      head: nextHead,
      wrapped,
      food: this.food,
      score: this.score,
    };
  }
}
