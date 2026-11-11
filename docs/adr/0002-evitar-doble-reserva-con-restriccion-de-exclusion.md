# ADR 0002: Evitar la doble reserva con una restricción de exclusión de PostgreSQL

- **Estado:** Aceptado
- **Fecha:** 2026-11-09

## Contexto
Dos jugadores pueden intentar reservar la misma cancha en el mismo horario casi al mismo instante.
Si la aplicación comprueba "¿está libre?" y después inserta, ambas peticiones pueden ver el horario
libre y ambas insertar: una doble reserva. Además hay que soportar reservas de varias horas
(10:00-12:00 choca con 11:00-12:00) y un bloqueo temporal mientras el jugador paga.

## Opciones consideradas
1. **Consultar y luego insertar en la aplicación.** Tiene una condición de carrera inevitable.
2. **`SELECT ... FOR UPDATE` sobre la cancha o transacciones `SERIALIZABLE`.** Funciona, pero serializa
   todas las reservas de una cancha (o exige reintentos), y la corrección depende de que cada ruta de
   código recuerde usarlo.
3. **Una fila por turno de una hora con índice único.** Sirve para turnos de tamaño fijo, pero obliga a
   descomponer las reservas largas y a gestionar varias filas por reserva.
4. **Restricción de exclusión (`EXCLUDE USING gist`) sobre el rango de tiempo.** La base de datos
   rechaza cualquier inserción cuyo rango se solape con otra reserva activa de la misma cancha.

## Decisión
Opción 4. La tabla `bookings` tiene:

```sql
EXCLUDE USING gist (court_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
WHERE (status IN ('pending', 'confirmed'))
```

- El rango es `[inicio, fin)`: 10:00-11:00 y 11:00-12:00 conviven; 10:00-12:00 y 11:00-12:00 no.
- Solo cuentan las reservas `pending` y `confirmed`: cancelar o expirar libera el horario.
- La aplicación **no consulta antes de insertar**: inserta directamente y traduce el error `23P01`
  (exclusion_violation) a un `409 Conflict`. Quien pierde la carrera recibe un mensaje claro.
- Requiere la extensión `btree_gist`, que crea la migración.

### Bloqueo temporal
Una reserva nueva nace `pending` con `expires_at` (10 minutos por defecto, `BOOKING_HOLD_MINUTES`).
Una restricción no puede depender de `now()`, así que los bloqueos vencidos se tratan así:
- Al crear una reserva, se marcan `expired` los bloqueos vencidos de ese rango antes de insertar.
- Las consultas de disponibilidad ignoran los `pending` con `expires_at` pasado.
- Una limpieza cada minuto los marca `expired` por orden; no es necesaria para la corrección.
- Confirmar es una sola sentencia `UPDATE ... WHERE status = 'pending' AND expires_at > now()`, de modo
  que un bloqueo vencido no se puede confirmar ni siquiera en una carrera con la limpieza.

## Consecuencias
- (+) La garantía vale para cualquier camino de escritura, incluso un `INSERT` manual o un servicio futuro.
- (+) Sin bloqueos explícitos ni reintentos en la aplicación; las reservas de otras canchas no se frenan.
- (+) Soporta reservas de duración variable sin trucos.
- (−) Lógica de negocio en el esquema: hay que mantener la migración y conocer `gist`.
- (−) Atada a PostgreSQL (extensión `btree_gist`).
- (−) Las reservas y canchas tienen `ON DELETE RESTRICT`: no se puede borrar un local o cancha con
  reservas; la API lo informa con un 409 y se recomienda desactivar la cancha.

## Cómo se verificó
`bookings.concurrency.spec.ts` ejecuta contra PostgreSQL real, sobre una base temporal creada con las
migraciones: 20 peticiones simultáneas al mismo horario (gana 1, 19 reciben 409), la carrera repetida
5 veces, solapamientos parciales simultáneos, bloqueos vencidos bajo carga y un `INSERT` directo que la
base rechaza. Al quitar la restricción de la migración, 9 de esos 12 tests fallan: las pruebas detectan
de verdad el problema que la restricción resuelve.
