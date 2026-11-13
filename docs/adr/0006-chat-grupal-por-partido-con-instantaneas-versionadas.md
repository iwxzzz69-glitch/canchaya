# ADR 0006: Chat grupal por partido con eventos de estado versionados

- **Estado:** Aceptado
- **Fecha:** 2026-11-13

## Contexto
Quien organiza un partido abierto y quienes se unen necesitan coordinarse (quién lleva el balón, a qué hora llegar).
Eso es una sala de chat con **miembros que cambian**: entra gente, sale gente y el partido puede cancelarse. El bus
entrega "al menos una vez" y no garantiza el orden, así que "entró Luis" y "salió Luis" pueden llegar al revés o
repetidos. Si el chat los aplicara tal cual, Luis podría quedar dentro de una sala que ya abandonó (un problema de
privacidad, no solo de estética).

## Decisión
- **Cada evento de partido trae el estado completo, no solo el cambio.** `match.opened`, `match.player_joined`,
  `match.player_left` y `match.cancelled` llevan la lista actual de miembros, el estado y una `version`. El
  campo `changedPlayer` solo sirve para redactar el aviso ("Luis se unió al partido").
- **La versión sale de la propia fila del partido** (`matches.version`, +1 en el mismo `UPDATE` que ocupa o libera
  un lugar o cancela). Como todos esos cambios tocan la misma fila, PostgreSQL los ordena; no se depende de
  relojes ni de IDs de la bandeja de salida (cuyo orden de creación no coincide con el de confirmación cuando hay
  transacciones concurrentes). El evento se guarda en la bandeja **después** de ese `UPDATE`, con la fila ya
  bloqueada, así que la instantánea y su versión son coherentes aunque entren varias personas a la vez.
- **El chat aplica un evento solo si su versión es mayor que la guardada.** Repetidos y atrasados se descartan; el
  resultado final es el mismo en cualquier orden. En MongoDB se hace con concurrencia optimista (se escribe solo si
  la sala sigue con la versión y el estado leídos; si no, se reintenta).
- **Una sala cerrada no se reabre**, y si la reserva se canceló antes de que llegara el partido, este nace cerrado.
  Cancelar la reserva (`booking.cancelled`) cierra también la sala del partido asociada.
- **Quien sale deja de recibir mensajes en el acto**: además de impedirle escribir (la pertenencia se vuelve a
  leer en cada envío), el gateway lo saca de la sala de Socket.IO en todas sus pestañas.
- **Sala propia por partido** (`match:<id>`), solo con organizador y jugadores. El dueño del local no entra: es un
  chat entre jugadores. Los avisos del sistema son mensajes con `kind: "system"`.
- **Cola propia** (`chat.matches`, enlazada a `match.*`, con su cola de muertos) para no tocar la cola de reservas
  que ya existe en instalaciones anteriores.

## Consecuencias
- Un evento más pesado (lista de miembros, máximo 21 personas) a cambio de que el consumidor sea trivialmente
  idempotente y tolerante al desorden.
- Si dos eventos se aplican casi a la vez, el aviso del intermedio puede no generarse (el estado final siempre es
  correcto). Un fallo justo entre actualizar la sala y guardar el aviso también lo omite; es un adorno, no un dato.
- Quien entra después ve el historial anterior (incluidos los avisos). Es una decisión consciente: sirve para
  ponerse al día; se puede restringir más adelante.
- Los nombres que se comparten son solo los primeros nombres, igual que en la API de partidos.
- Pendiente: expirar o cerrar la sala cuando el partido ya se jugó.
