/**
 * Datos de demostración: locales, canchas, jugadores, reservas pagadas y partidos abiertos.
 * Requiere el monolito con la pasarela simulada (PAYMENT_PROVIDER=fake, el valor por defecto en desarrollo).
 *
 *   node scripts/seed-demo.mjs                       (usa http://localhost:3001)
 *   API_URL=http://localhost:3001 node scripts/seed-demo.mjs
 *
 * Es seguro ejecutarlo una sola vez por base de datos: si las cuentas ya existen, se detiene sin duplicar.
 * Contraseña de todas las cuentas: Clave12345  (dueño: dueno@demo.pe; jugadores: ana@demo.pe, luis@demo.pe, ...)
 */
const API = process.env.API_URL ?? 'http://localhost:3001';
const PASSWORD = 'Clave12345';

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`), { status: res.status });
  return json;
}
const register = (name, email, role) => call('POST', '/auth/register', null, { name, email, password: PASSWORD, role });

// Hora de Lima (UTC-5) de hoy + `days`, a las `hour`:00
const slot = (days, hour) => {
  const [y, m, d] = new Date(Date.now() - 5 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + 5)).toISOString();
};

async function main() {
  let owner;
  try {
    owner = await register('Dueño Demo', 'dueno@demo.pe', 'owner');
  } catch (e) {
    if (e.status === 409) return console.log('La demo ya estaba cargada en esta base de datos. No se hizo nada.');
    throw e;
  }
  const o = owner.accessToken;

  const venue = async (name, address, zone, description, courts) => {
    const v = await call('POST', '/venues', o, { name, address, zone, description });
    const created = [];
    for (const c of courts) created.push(await call('POST', `/venues/${v.id}/courts`, o, c));
    return { ...v, courts: created };
  };
  const bombonera = await venue('La Bombonera de Barranco', 'Jr. Domeyer 240', 'Barranco', 'Grass sintético con luces LED y vestuarios.', [
    { name: 'Cancha 1', sport: 'football', pricePerHour: 90 }, { name: 'Cancha 2', sport: 'football', pricePerHour: 70 }]);
  const padel = await venue('Pádel Club Surco', 'Av. Primavera 1180', 'Surco', 'Dos pistas de cristal, techadas.', [
    { name: 'Pista central', sport: 'padel', pricePerHour: 60 }, { name: 'Pista 2', sport: 'padel', pricePerHour: 55 }]);
  const sanBorja = await venue('Polideportivo San Borja', 'Av. Aviación 3050', 'San Borja', 'Losas techadas para vóley y básquet.', [
    { name: 'Losa A', sport: 'volleyball', pricePerHour: 45 }, { name: 'Losa B', sport: 'basketball', pricePerHour: 50 }]);
  await venue('Arena Miraflores', 'Calle Berlín 520', 'Miraflores', 'Fulbito 7 contra 7, con parrilla para el tercer tiempo.', [
    { name: 'Cancha Norte', sport: 'football', pricePerHour: 110 }]);

  const players = {};
  for (const [key, name] of [['ana', 'Ana Torres'], ['luis', 'Luis Quispe'], ['marta', 'Marta Rojas'], ['diego', 'Diego Salas'], ['camila', 'Camila Vega']]) {
    players[key] = await register(name, `${key}@demo.pe`, 'player');
  }
  const book = async (who, court, days, hour, hours = 1) => {
    const b = await call('POST', '/bookings', players[who].accessToken, { courtId: court.id, startsAt: slot(days, hour), hours });
    await call('POST', `/bookings/${b.id}/pay`, players[who].accessToken, { tokenId: 'tkn_test_ok' });
    return b;
  };

  // Algunas horas ocupadas, para que el tablero de turnos se vea vivo.
  await book('camila', bombonera.courts[0], 1, 18);
  await book('camila', bombonera.courts[0], 1, 21);
  await book('diego', bombonera.courts[0], 2, 20);

  // Partidos abiertos con distinto nivel y cupo.
  const m1 = await book('ana', bombonera.courts[0], 1, 19, 2);
  const match1 = await call('POST', '/matches', players.ana.accessToken, { bookingId: m1.id, spots: 4, level: 'casual', notes: 'Traer polo oscuro, hay chalecos.' });
  await call('POST', `/matches/${match1.id}/join`, players.luis.accessToken);
  const m2 = await book('diego', padel.courts[0], 1, 19);
  await call('POST', '/matches', players.diego.accessToken, { bookingId: m2.id, spots: 3, level: 'intermediate', notes: 'Jugamos dobles, falta gente para rotar.' });
  const m3 = await book('marta', sanBorja.courts[0], 2, 18);
  const match3 = await call('POST', '/matches', players.marta.accessToken, { bookingId: m3.id, spots: 6, level: 'advanced' });
  await call('POST', `/matches/${match3.id}/join`, players.camila.accessToken);
  await call('POST', `/matches/${match3.id}/join`, players.luis.accessToken);

  console.log('Demo cargada: 4 locales, 7 canchas, 5 jugadores, reservas pagadas y 3 partidos abiertos.');
  console.log('Cuentas (clave Clave12345): dueno@demo.pe, ana@demo.pe, luis@demo.pe, marta@demo.pe, diego@demo.pe, camila@demo.pe');
}
main().catch((e) => { console.error(`Error al cargar la demo: ${e.message}`); process.exit(1); });
