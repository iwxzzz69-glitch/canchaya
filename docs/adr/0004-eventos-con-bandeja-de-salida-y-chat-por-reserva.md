# ADR 0004: Eventos de reservas con bandeja de salida (outbox) y chat por reserva

- **Estado:** Aceptado
- **Fecha:** 2026-11-11

## Contexto
Cuando una reserva se confirma o se cancela, el chat-service debe enterarse para abrir o cerrar la conversación
entre jugador y dueño. El monolito (PostgreSQL) y el chat (MongoDB) no comparten base de datos ni transacción.

El problema clásico: si el monolito confirma la reserva y *después* publica en RabbitMQ, un corte entre ambos
pasos deja una reserva confirmada sin chat; si publica primero, puede anunciar algo que luego se revierte.

## Decisión
- **Bandeja de salida transaccional (`outbox_events`).** El evento se inserta en la MISMA transacción que
  cambia el estado de la reserva (al confirmar el pago, y al cancelar una reserva que ya estaba confirmada).
  O se confirma y se anuncia, o ninguna de las dos cosas. Una reserva que nunca se confirmó no genera eventos.
- **Relevo (`OutboxRelay`).** Cada segundo lee los pendientes en orden, los publica en el exchange `topic`
  durable `canchaya.events` con confirmaciones del broker y mensajes persistentes, y recién entonces los marca
  como publicados. `FOR UPDATE SKIP LOCKED` permite varias instancias del monolito sin publicar dos veces a la
  vez. Ante un fallo se detiene el lote (un evento posterior nunca adelanta a uno que falló), registra el error
  y reintenta. Sin `RABBITMQ_URL` los eventos esperan en la tabla y no se pierden.
- **Entrega "al menos una vez" + consumidor idempotente.** Un corte entre publicar y marcar puede repetir un
  mensaje; cada uno lleva `eventId`, y aplicarlo dos veces no cambia nada.
- **Consumidor tolerante al orden.** `booking.cancelled` cierra la sala aunque `booking.confirmed` no haya
  llegado; una sala cerrada nunca se reabre. Los mensajes inválidos, o que fallan tras varios intentos, van a una
  cola de mensajes muertos (`chat.bookings.dead`) en vez de bloquear la cola o perderse.
- **Contrato versionado** en `docs/contracts/` con un ejemplo que verifican los tests de ambos servicios.
- **Chat por reserva.** Una sala por reserva confirmada; solo entran el jugador y el dueño del local (ni
  siquiera un admin). El chat valida el mismo JWT HS256 del monolito, sin llamarlo. Antes de cada mensaje se
  vuelve a leer la sala: si la reserva se canceló, ya no se puede escribir (el historial se conserva). Hay
  límite de mensajes por socket y de longitud. Redis sincroniza presencia y mensajes entre varias instancias.

## Alternativas descartadas
- **Publicar directamente tras el commit:** pierde eventos ante un corte. Es el problema que resuelve el outbox.
- **Transacciones distribuidas (2PC):** complejas y sin soporte entre PostgreSQL, MongoDB y RabbitMQ.
- **Que el chat consulte al monolito en cada mensaje:** acopla la disponibilidad del chat a la del monolito.

## Consecuencias
- Hay un retraso de ~1 s entre confirmar y que aparezca la sala (consistencia eventual).
- El orden se garantiza dentro de una instancia del relevo; entre reservas distintas no importa.
- La tabla `outbox_events` crece: queda pendiente una limpieza periódica de los ya publicados.
- Las reseñas, los pagos y otras reservas no pasan por el bus: solo los dos eventos de reserva.
