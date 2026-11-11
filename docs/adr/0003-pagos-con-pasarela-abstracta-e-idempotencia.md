# ADR 0003: Pagos con pasarela intercambiable, un solo cobro por reserva y conciliación por webhook

- **Estado:** Aceptado
- **Fecha:** 2026-11-10

## Contexto
Una reserva nace `pending` y bloquea el horario unos minutos. El jugador paga con una tarjeta tokenizada
en el navegador (la API nunca ve el número de tarjeta). Hay cuatro riesgos reales:

1. **Doble cobro**: doble clic, reintento del navegador o dos pestañas pagando la misma reserva.
2. **Resultado desconocido**: la pasarela cobra pero la respuesta se pierde (timeout, 5xx).
3. **Bloqueo vencido a mitad del cobro**: el horario se libera y lo toma otro jugador mientras el pago
   está en curso.
4. **Dinero cobrado sin reserva**: se cobra, pero la reserva ya fue cancelada o perdida.

## Decisión
- **Interfaz `PaymentProvider`** (`charge`, `getCharge`, `refund`). Hay una implementación para **Culqi**
  (API v2, con `fetch` nativo, sin SDK) y una **simulada** para desarrollo y tests. El servicio no conoce
  a Culqi. La simulada se niega a arrancar con `NODE_ENV=production`.
- **Un intento vivo por reserva, garantizado por la base de datos**: índice único parcial
  `payments_one_active_per_booking ON payments(booking_id) WHERE status IN ('processing','succeeded')`.
  Los pagos fallidos no estorban, así que se puede reintentar con otra tarjeta. Antes del `INSERT` se
  bloquea la fila de la reserva (`FOR UPDATE`) para que los intentos simultáneos hagan fila en vez de
  provocar deadlocks.
- **El bloqueo se alarga** (`PAYMENT_GRACE_SECONDS`, 180 s por defecto) dentro de la misma transacción que
  crea el intento, de modo que no puede vencer durante el cobro.
- **El cobro se aprueba en un único punto** (`finalizeSuccessfulCharge`): pago `succeeded` y reserva
  `confirmed` en una transacción, de forma idempotente. Lo usan el flujo normal y el webhook.
- **Resultado desconocido ≠ fallo**: ante un error de red o un 5xx el pago queda `processing`, la API
  responde 503 y no se permite otro cobro mientras tanto. El webhook (o un admin) lo resuelve.
- **Webhook sin confiar en el POST**: la documentación de Culqi no describe una firma verificable, así que
  la URL lleva un secreto (`CULQI_WEBHOOK_SECRET`, comparado en tiempo constante) y del evento solo se usa
  el id del cargo, que se **vuelve a consultar** a Culqi con la llave secreta. Se exige que el cargo esté
  pagado, que su monto coincida con el del pago y que su `payment_id` exista y siga en `processing`.
- **Devoluciones**: si se cobró pero la reserva ya no se puede confirmar, se devuelve automáticamente
  (`refund_pending` → `refunded`). Cancelar una reserva pagada también devuelve el total. Si la pasarela
  rechaza la devolución queda `refund_failed` (nunca se pierde) y un admin puede reintentarla con
  `POST /payments/:id/retry-refund`. La reserva se cancela igualmente y la respuesta indica `refund`:
  `none`, `refunded` o `failed`.
- Los montos se guardan en soles (`numeric(10,2)`) y se envían en céntimos enteros. Nunca se guarda el
  token de tarjeta.

## Consecuencias
- Cambiar de pasarela (Stripe, Mercado Pago) es escribir otra clase que implemente la interfaz.
- Un pago atascado en `processing` por una caída larga de Culqi requiere conciliación; hoy la hace el
  webhook. **Pendiente (posible mejora)**: un job que consulte los pagos `processing` antiguos.
- Las devoluciones son siempre totales; no hay política de penalidades.
- El servicio de reservas depende del de pagos (para devolver al cancelar); a cambio, `confirm` ya no
  existe: **una reserva solo se confirma pagando**.

## Qué no se pudo verificar contra Culqi real
Se desarrolló sin acceso a la API en vivo; los tests cubren el contrato supuesto con respuestas simuladas.
Conviene validar en el sandbox: el endpoint y los valores de `reason` de `POST /refunds`, qué campo marca un
cargo como pagado (`getCharge` acepta `outcome.type`, `response_code` y `state`), el límite de 80
caracteres de `description` y los montos mínimos.
