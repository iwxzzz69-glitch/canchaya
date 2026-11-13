# ADR 0005: Partidos abiertos con cupo atómico

- **Estado:** Aceptado
- **Fecha:** 2026-11-11

## Contexto
Quien tiene una reserva confirmada puede buscar jugadores para completar el equipo (un "partido abierto").
Otros jugadores lo encuentran, se unen y se salen. El riesgo es el mismo que con las reservas: dos personas
pidiendo el último lugar a la vez no pueden entrar las dos, y el contador de lugares nunca debe contradecir
a la lista real de jugadores.

## Decisión
- **Un partido por reserva** (`matches.booking_id` único) y solo con una reserva **confirmada, propia y futura**.
  El organizador no ocupa lugar: `spots_total` son los jugadores que faltan.
- **Ocupar un lugar es un único `UPDATE` atómico** que comprueba todo en la misma sentencia: que el partido
  esté abierto, que quede cupo (`spots_taken < spots_total`), que quien pide no sea el organizador y que la
  reserva siga confirmada y sin empezar. PostgreSQL atiende de una en una a quienes compiten por la misma
  fila, así que la segunda ve el cupo ya ocupado y no actualiza nada. No hay "leer, comprobar y escribir".
- **Una persona no entra dos veces**: la clave primaria compuesta `(match_id, player_id)` de `match_players`.
  El `INSERT` y el `UPDATE` van en una transacción: si el cupo se llenó, se deshace también el `INSERT`.
- **Segunda capa en la base de datos**: `CHECK (spots_taken BETWEEN 0 AND spots_total)` y `spots_total BETWEEN
  1 AND 20`. Aunque un error en la aplicación se saltara la comprobación, la base se negaría a sobrepasar el
  cupo. Se comprobó quitando la condición de cupo del `UPDATE`: el contador seguía siendo correcto y solo
  cambiaba el error (de 409 a un error de base de datos), que los tests detectan.
- **Salirse** bloquea la fila del partido, borra al jugador y descuenta un lugar en la misma transacción,
  así dos salidas simultáneas de la misma persona descuentan una sola vez.
- **Cancelar la reserva cierra el partido en la misma transacción** de la cancelación: nadie puede unirse a
  una cancha cancelada, y los que ya estaban dentro ven el partido como cancelado. El organizador también
  puede cerrar su partido sin tocar la reserva.
- **Privacidad**: las listas públicas muestran solo el primer nombre; nunca correos ni ids de usuarios.
- **Una sola lista de entidades** (`ALL_ENTITIES`) alimenta la aplicación, las migraciones y los tests, y un
  test verifica que no falte ninguna. Esto evitó repetir un fallo real: con `autoLoadEntities`, olvidar
  registrar una entidad en un módulo la dejaba fuera solo en el servidor, y los tests no lo notaban.

## Consecuencias
- El precio sugerido por jugador (`total / (cupos + 1)`) es solo una referencia: el pago sigue siendo del
  organizador y no se reparten cobros entre jugadores.
- Un partido completo desaparece de la búsqueda pero conserva su detalle.
- **Pendiente (Fase 5b)**: sala de chat grupal por partido. Requiere eventos nuevos (`match.player_joined`,
  `match.player_left`, `match.cancelled`) por el outbox existente y salas con varios participantes en el chat.
