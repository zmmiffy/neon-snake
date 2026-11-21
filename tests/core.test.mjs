import test from "node:test";
import assert from "node:assert/strict";

import {
  SnakeGame,
  DIRECTIONS,
  BASE_STEP_MS,
  MIN_STEP_MS,
  directionFromName,
} from "../js/core.js";

const fixedRng = (value = 0) => () => value;

function makeGame(overrides = {}) {
  return new SnakeGame({
    cols: 10,
    rows: 10,
    startLength: 4,
    rng: fixedRng(0),
    ...overrides,
  });
}

test("starts with a four-cell snake in the middle, moving right", () => {
  const game = makeGame();

  assert.equal(game.length, 4);
  assert.equal(game.direction, "right");
  assert.deepEqual(game.head, { x: 6, y: 5 });
  assert.deepEqual(game.snake, [
    { x: 6, y: 5 },
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
  ]);
  assert.equal(game.score, 0);
  assert.equal(game.eaten, 0);
  assert.equal(game.alive, true);
  assert.equal(game.won, false);
  assert.equal(game.food.x, 0);
  assert.equal(game.food.y, 0);
});

test("directionFromName resolves valid names and rejects everything else", () => {
  assert.equal(directionFromName("up"), DIRECTIONS.up);
  assert.equal(directionFromName("left"), DIRECTIONS.left);
  assert.equal(directionFromName("north"), null);
  assert.equal(directionFromName(null), null);
});

test("one step moves the head and pops the tail", () => {
  const game = makeGame();
  const event = game.step();

  assert.equal(event.type, "move");
  assert.deepEqual(game.head, { x: 7, y: 5 });
  assert.equal(game.length, 4);
  assert.deepEqual(game.snake.at(-1), { x: 4, y: 5 });
});

test("reversing into your own neck is rejected", () => {
  const game = makeGame();
  assert.equal(game.turn("left"), false);
  assert.deepEqual(game.turnQueue, []);
  assert.equal(game.turn("up"), true);
});

test("duplicate turns are ignored", () => {
  const game = makeGame();
  assert.equal(game.turn("right"), false);
  assert.equal(game.turn("up"), true);
  assert.equal(game.turn("up"), false);
});

test("at most two turns can be buffered", () => {
  const game = makeGame();
  assert.equal(game.turn("up"), true);
  assert.equal(game.turn("left"), true);
  assert.equal(game.turn("down"), false);
  assert.equal(game.turnQueue.length, 2);
});

test("buffered turns are applied one per tick", () => {
  const game = makeGame();
  game.turn("up");
  game.turn("left");

  game.step();
  assert.equal(game.direction, "up");
  assert.deepEqual(game.head, { x: 6, y: 4 });

  game.step();
  assert.equal(game.direction, "left");
  assert.deepEqual(game.head, { x: 5, y: 4 });
});

test("invalid vector turns are rejected", () => {
  const game = makeGame();
  assert.equal(game.turn({ x: 1, y: 1 }), false);
  assert.equal(game.turn({ x: Number.NaN, y: 0 }), false);
  assert.equal(game.turn({ x: 0, y: 1 }), true);
});

test("classic mode dies at the wall", () => {
  const game = makeGame({ cols: 6, rows: 6, startLength: 2 });

  assert.deepEqual(game.head, { x: 3, y: 3 });
  assert.equal(game.step().type, "move"); // 4
  assert.equal(game.step().type, "move"); // 5
  const death = game.step(); // out of bounds

  assert.equal(death.type, "die");
  assert.equal(death.reason, "wall");
  assert.equal(game.alive, false);
  assert.deepEqual(game.head, { x: 5, y: 3 });
});

test("wrap mode crosses the wall and reports the wrap", () => {
  const game = makeGame({ cols: 6, rows: 6, startLength: 2, wrap: true });

  game.step();
  game.step();
  assert.deepEqual(game.head, { x: 5, y: 3 });

  const event = game.step();
  assert.equal(event.type, "move");
  assert.equal(event.wrapped, true);
  assert.deepEqual(game.head, { x: 0, y: 3 });
  assert.equal(game.alive, true);
});

test("eating grows the snake, scores 10, and spawns new food off-body", () => {
  const game = makeGame();
  game.food = { x: 7, y: 5 };

  const event = game.step();

  assert.equal(event.type, "eat");
  assert.equal(game.score, 10);
  assert.equal(game.eaten, 1);
  assert.equal(game.length, 5);
  assert.deepEqual(game.head, { x: 7, y: 5 });
  assert.ok(game.food);
  assert.equal(game.isOccupied(game.food.x, game.food.y), false);
});

test("eating enough food raises level and increases speed", () => {
  const game = makeGame();
  assert.equal(game.level, 1);
  assert.equal(game.stepMs, BASE_STEP_MS);

  game.eaten = 4;
  assert.equal(game.level, 2);

  game.eaten = 500;
  assert.equal(game.stepMs, MIN_STEP_MS);
  assert.equal(game.speed, Math.round((BASE_STEP_MS / MIN_STEP_MS) * 10) / 10);
});

test("moving into the vacated tail cell is legal", () => {
  const game = makeGame();
  game.snake = [
    { x: 5, y: 5 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 5 },
  ];
  game.direction = "left";
  game.food = { x: 0, y: 0 };

  const event = game.step();

  assert.equal(event.type, "move");
  assert.deepEqual(game.head, { x: 4, y: 5 });
  assert.equal(game.alive, true);
});

test("moving into a body cell that is not the tail is fatal", () => {
  const game = makeGame();
  game.snake = [
    { x: 5, y: 5 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 5 },
    { x: 4, y: 6 },
  ];
  game.direction = "left";
  game.food = { x: 0, y: 0 };

  const event = game.step();

  assert.equal(event.type, "die");
  assert.equal(event.reason, "self");
  assert.equal(game.alive, false);
});

test("spawning food never places it on the snake", () => {
  for (let seed = 0; seed < 40; seed += 1) {
    let value = seed / 40;
    const game = new SnakeGame({
      cols: 12,
      rows: 12,
      startLength: 4,
      rng: () => {
        value = (value + 0.61803398875) % 1;
        return value;
      },
    });
    assert.equal(game.isOccupied(game.food.x, game.food.y), false);
  }
});

test("a full board produces a win state and no food", () => {
  const game = makeGame({ cols: 6, rows: 6, startLength: 2 });
  game.snake = [];
  for (let y = 0; y < game.rows; y += 1) {
    for (let x = 0; x < game.cols; x += 1) {
      game.snake.push({ x, y });
    }
  }

  const result = game.spawnFood();

  assert.equal(result, null);
  assert.equal(game.food, null);
  assert.equal(game.won, true);
});

test("reset restores the starting state after a run", () => {
  const game = makeGame();
  game.food = { x: 7, y: 5 };
  game.step();
  game.step();

  game.reset();

  assert.equal(game.score, 0);
  assert.equal(game.eaten, 0);
  assert.equal(game.length, 4);
  assert.equal(game.direction, "right");
  assert.equal(game.alive, true);
  assert.equal(game.won, false);
  assert.deepEqual(game.head, { x: 6, y: 5 });
  assert.deepEqual(game.turnQueue, []);
});

test("step after death is a no-op death report", () => {
  const game = makeGame({ cols: 6, rows: 6, startLength: 2 });
  game.step();
  game.step();
  game.step();

  const event = game.step();
  assert.equal(event.type, "die");
  assert.equal(game.head.x, 5);
});
