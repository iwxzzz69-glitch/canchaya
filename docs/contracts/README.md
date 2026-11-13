# Contrato de eventos de reservas (versión 1)

El monolito publica en el exchange `topic` durable `canchaya.events`, con clave de ruteo igual al `type`
(`booking.confirmed` o `booking.cancelled`). El chat-service consume la cola `chat.bookings`, enlazada a `booking.*`.

`booking-events.v1.example.json` es el ejemplo de referencia. Los dos servicios lo verifican en sus tests:
el monolito comprueba que lo que emite tiene exactamente esa forma (mismas claves y tipos) y el chat comprueba
que su validador lo acepta. Si cambias el contrato, cambia primero este archivo y sube `version`.

Reglas: la entrega es "al menos una vez" (un `eventId` puede repetirse y el consumidor es idempotente) y no se
garantiza el orden entre eventos de reservas distintas; para una misma reserva el consumidor tolera cualquier orden.

## Eventos de partido (versión 1)

Los partidos usan las claves `match.opened`, `match.player_joined`, `match.player_left` y `match.cancelled`, que llegan
a la cola `chat.matches` (enlazada a `match.*`). Ejemplo de referencia: `match-events.v1.example.json`, verificado igual
que el de reservas por los dos servicios.

A diferencia de los de reserva, **cada evento es una instantánea completa** del partido (`members`, `status`) más su
`version`, que sube de uno en uno con cada cambio. El consumidor aplica un evento solo si su `version` es mayor que la
que ya tiene; así los repetidos y los desordenados no hacen daño. `members[0]` es siempre el organizador y `changedPlayer`
es quien entró o salió (`null` en `opened` y `cancelled`). Razones en el
[ADR 0006](../adr/0006-chat-grupal-por-partido-con-instantaneas-versionadas.md).
