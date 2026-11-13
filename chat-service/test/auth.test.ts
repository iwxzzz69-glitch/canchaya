import assert from 'node:assert/strict';
import { test } from 'node:test';
import jwt from 'jsonwebtoken';
import { bearerToken, verifyToken } from '../src/auth';
import { SECRET, tokenFor } from './helpers';

test('acepta un token válido y devuelve id, email y rol', () => {
  assert.deepEqual(verifyToken(tokenFor('u1', 'owner'), SECRET), { id: 'u1', email: 'u1@test.com', role: 'owner' });
});

test('rechaza firma con otro secreto, token expirado y basura', () => {
  assert.equal(verifyToken(tokenFor('u1', 'player', 'otro-secreto'), SECRET), null);
  const expired = jwt.sign({ sub: 'u1', role: 'player' }, SECRET, { algorithm: 'HS256', expiresIn: -10 });
  assert.equal(verifyToken(expired, SECRET), null);
  for (const bad of ['', 'abc', undefined, null, 5, {}]) assert.equal(verifyToken(bad, SECRET), null);
});

test('rechaza alg none y otros algoritmos distintos de HS256', () => {
  const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"sub":"u1","role":"admin"}').toString('base64url')}.`;
  assert.equal(verifyToken(none, SECRET), null);
  assert.equal(verifyToken(jwt.sign({ sub: 'u1', role: 'player' }, SECRET, { algorithm: 'HS512' }), SECRET), null);
});

test('rechaza tokens sin sub o con rol desconocido', () => {
  assert.equal(verifyToken(jwt.sign({ role: 'player' }, SECRET), SECRET), null);
  assert.equal(verifyToken(jwt.sign({ sub: 'u1', role: 'superadmin' }, SECRET), SECRET), null);
  assert.equal(verifyToken(jwt.sign({ sub: 'u1' }, SECRET), SECRET), null);
});

test('con secreto vacío no valida nada (ni siquiera tokens firmados con cadena vacía)', () => {
  const signedWithEmpty = jwt.sign({ sub: 'u1', role: 'admin' }, 'x'); // jsonwebtoken exige secreto no vacío
  assert.equal(verifyToken(signedWithEmpty, ''), null);
});

test('bearerToken extrae el token del encabezado', () => {
  assert.equal(bearerToken('Bearer abc.def'), 'abc.def');
  assert.equal(bearerToken('Basic abc'), undefined);
  assert.equal(bearerToken(undefined), undefined);
});
