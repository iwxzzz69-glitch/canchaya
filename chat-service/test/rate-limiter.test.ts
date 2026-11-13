import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimiter } from '../src/rate-limiter';

test('permite hasta el límite y bloquea el exceso dentro de la ventana', () => {
  let t = 0;
  const rl = new RateLimiter(3, 1000, () => t);
  assert.deepEqual([rl.allow(), rl.allow(), rl.allow(), rl.allow()], [true, true, true, false]);
});

test('vuelve a permitir cuando pasa la ventana', () => {
  let t = 0;
  const rl = new RateLimiter(2, 1000, () => t);
  rl.allow();
  rl.allow();
  assert.equal(rl.allow(), false);
  t = 1001;
  assert.equal(rl.allow(), true);
});

test('es deslizante: libera de a poco, no todo junto', () => {
  let t = 0;
  const rl = new RateLimiter(2, 1000, () => t);
  rl.allow(); // t=0
  t = 600;
  rl.allow(); // t=600
  t = 1100; // el primero ya salió de la ventana, el segundo no
  assert.equal(rl.allow(), true);
  assert.equal(rl.allow(), false);
});
