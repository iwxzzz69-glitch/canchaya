import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { InvalidEventError, parseBookingEvent, parseEvent, parseMatchEvent } from '../src/events';
import { bookingEvent, matchEvent } from './helpers';

const raw = (o: unknown) => Buffer.from(JSON.stringify(o));

test('acepta un evento válido tal como lo publica el monolito', () => {
  const e = bookingEvent('booking.confirmed');
  assert.deepEqual(parseBookingEvent(raw(e)), e);
});

test('ignora campos de más en el mensaje (no pasan al resultado)', () => {
  const e = bookingEvent('booking.cancelled') as any;
  e.extra = 'x';
  e.data.tarjeta = '4111';
  const parsed = parseBookingEvent(raw(e)) as any;
  assert.equal(parsed.extra, undefined);
  assert.equal(parsed.data.tarjeta, undefined);
});

test('rechaza lo que no cumple el contrato', () => {
  const ok = bookingEvent('booking.confirmed') as any;
  const cases: [string, unknown][] = [
    ['no es JSON', 'esto no es json{'],
    ['es un array', []],
    ['null', null],
    ['versión 2', { ...ok, version: 2 }],
    ['tipo desconocido', { ...ok, type: 'booking.exploded' }],
    ['sin data', { ...ok, data: undefined }],
    ['sin playerId', { ...ok, data: { ...ok.data, playerId: '' } }],
    ['ownerId numérico', { ...ok, data: { ...ok.data, ownerId: 5 } }],
    ['fecha inválida', { ...ok, data: { ...ok.data, startsAt: 'mañana' } }],
    ['occurredAt faltante', { ...ok, occurredAt: undefined }],
    ['texto enorme', { ...ok, data: { ...ok.data, venueName: 'x'.repeat(1000) } }],
  ];
  for (const [name, value] of cases) {
    const input = typeof value === 'string' ? Buffer.from(value) : raw(value);
    assert.throws(() => parseBookingEvent(input), InvalidEventError, name);
  }
});

// Ejemplo compartido con el monolito (docs/contracts): el monolito verifica que emite esta forma exacta.
// En Docker la carpeta docs se monta en /docs; si no está disponible, la prueba se omite.
const contractFile = path.join(__dirname, '..', '..', 'docs', 'contracts', 'booking-events.v1.example.json');
test('acepta el ejemplo del contrato v1 (confirmed y cancelled)', { skip: !existsSync(contractFile) }, () => {
  const example = JSON.parse(readFileSync(contractFile, 'utf8'));
  for (const type of ['booking.confirmed', 'booking.cancelled']) {
    const event = parseBookingEvent(JSON.stringify({ ...example, type }));
    assert.equal(event.type, type);
    assert.deepEqual(event.data, example.data);
  }
});

const A: [string, string] = ['ana', 'Ana'];
const L: [string, string] = ['luis', 'Luis'];

test('parseEvent despacha según el tipo: reservas y partidos', () => {
  assert.equal(parseEvent(raw(bookingEvent('booking.cancelled'))).type, 'booking.cancelled');
  const e = matchEvent('match.player_joined', 'm1', 2, [A, L], { changed: L });
  assert.deepEqual(parseEvent(raw(e)), e);
  assert.deepEqual(parseMatchEvent(raw(matchEvent('match.opened', 'm1', 1, [A]))).data.changedPlayer, null);
});

test('un evento de partido no pasa por el validador de reservas y al revés', () => {
  assert.throws(() => parseBookingEvent(raw(matchEvent('match.opened', 'm1', 1, [A]))), InvalidEventError);
  assert.throws(() => parseMatchEvent(raw(bookingEvent('booking.confirmed'))), InvalidEventError);
});

test('rechaza eventos de partido que no cumplen el contrato', () => {
  const ok = matchEvent('match.player_joined', 'm1', 2, [A, L], { changed: L }) as any;
  const cases: [string, unknown][] = [
    ['versión de partido 0', { ...ok, data: { ...ok.data, version: 0 } }],
    ['versión fraccionaria', { ...ok, data: { ...ok.data, version: 1.5 } }],
    ['versión como texto', { ...ok, data: { ...ok.data, version: '2' } }],
    ['estado inventado', { ...ok, data: { ...ok.data, status: 'finished' } }],
    ['sin miembros', { ...ok, data: { ...ok.data, members: [] } }],
    ['miembros que no es lista', { ...ok, data: { ...ok.data, members: 'ana' } }],
    ['demasiados miembros', { ...ok, data: { ...ok.data, members: Array.from({ length: 101 }, (_, i) => ({ id: `u${i}`, name: 'x' })) } }],
    ['miembro sin nombre', { ...ok, data: { ...ok.data, members: [{ id: 'ana' }] } }],
    ['el primero no es el organizador', { ...ok, data: { ...ok.data, members: [{ id: 'luis', name: 'Luis' }, { id: 'ana', name: 'Ana' }] } }],
    ['sin matchId', { ...ok, data: { ...ok.data, matchId: '' } }],
    ['changedPlayer inválido', { ...ok, data: { ...ok.data, changedPlayer: 'luis' } }],
    ['versión del contrato 2', { ...ok, version: 2 }],
    ['tipo desconocido', { ...ok, type: 'match.exploded' }],
  ];
  for (const [name, value] of cases) assert.throws(() => parseEvent(raw(value)), InvalidEventError, name);
});

const matchContractFile = path.join(__dirname, '..', '..', 'docs', 'contracts', 'match-events.v1.example.json');
test('acepta el ejemplo del contrato de partidos v1', { skip: !existsSync(matchContractFile) }, () => {
  const example = JSON.parse(readFileSync(matchContractFile, 'utf8'));
  for (const type of ['match.opened', 'match.player_joined', 'match.player_left', 'match.cancelled']) {
    const event = parseEvent(JSON.stringify({ ...example, type }));
    assert.equal(event.type, type);
    assert.deepEqual(event.data, example.data);
  }
});
