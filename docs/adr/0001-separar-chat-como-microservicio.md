# ADR 0001: Separar el chat y matchmaking como microservicio

- **Estado:** Aceptado
- **Fecha:** 2026-11-05

## Contexto
CanchaYa tiene un núcleo transaccional (usuarios, reservas, pagos) y una funcionalidad de tiempo real (chat, presencia, partidos abiertos). Ambas tienen perfiles de carga y requisitos muy distintos.

## Decisión
- Mantener el negocio principal como **monolito modular** (NestJS + PostgreSQL).
- Extraer **solo** el chat y matchmaking a un microservicio (Node + Socket.IO + MongoDB + Redis).
- Comunicar ambos por **eventos asíncronos** en RabbitMQ y compartir la validación del JWT.

## Justificación
- Las conexiones WebSocket son persistentes y escalan distinto que las peticiones REST.
- El chat tolera consistencia eventual; las reservas y pagos requieren consistencia fuerte (ACID).
- Si el chat cae, las reservas siguen funcionando.
- Un monolito para el resto evita la complejidad operativa de microservicios innecesarios.

## Consecuencias
- (+) Escalado y despliegue independientes del chat.
- (+) Aislamiento de fallos.
- (−) Más infraestructura (RabbitMQ, MongoDB, Redis).
- (−) Hay que manejar eventos duplicados y reintentos (idempotencia en el consumidor).
