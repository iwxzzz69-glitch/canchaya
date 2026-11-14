# Despliegue gratuito de la demo

Todo en planes gratuitos, sin tarjeta salvo que el proveedor la pida al registrarte:

| Pieza | Servicio | Notas |
|---|---|---|
| Frontend | Vercel | Carpeta `frontend` |
| Monolito y chat | Render (2 web services Docker) | Se duermen tras 15 min sin tráfico y tardan ~1 min en despertar |
| PostgreSQL | Neon | Render borra su Postgres gratuito a los 30 días, por eso se usa Neon |
| MongoDB | MongoDB Atlas (M0) | |
| RabbitMQ | CloudAMQP (Little Lemur) | 20 conexiones, 1 M mensajes/mes |

Redis no hace falta: solo sirve para varias instancias del chat y aquí hay una.

La pasarela de pago es la **simulada** (`PAYMENT_PROVIDER=fake`): no se cobra nada y por eso **no** se define `NODE_ENV=production` (el monolito se negaría a arrancar con la simulada). Es una demo, no un sistema para cobrar.

## 1. Crear las bases y la cola

1. **Neon**: crea un proyecto y copia la cadena de conexión (`postgresql://...?sslmode=require`). Las migraciones activan la extensión `btree_gist` solas.
2. **MongoDB Atlas**: crea un clúster gratuito (M0), un usuario de base de datos y, en *Network Access*, permite `0.0.0.0/0` (Render no tiene IP fija). Copia la cadena `mongodb+srv://...`.
3. **CloudAMQP**: crea una instancia *Little Lemur* y copia la URL `amqps://...`.

## 2. Backend y chat en Render

1. En Render: *New* > *Blueprint* y elige el repo `canchaya`. Lee `render.yaml` y crea `canchaya-api` y `canchaya-chat`.
2. Rellena lo que pide: `DATABASE_URL`, `RABBITMQ_URL` (en las dos), `MONGO_URL`. Deja `CHAT_CORS_ORIGIN` vacío por ahora.
3. `JWT_SECRET` de `canchaya-api` se genera solo. Cópialo (*Environment*) y pégalo igual en `canchaya-chat`. Si difieren, el chat rechaza todos los tokens.
4. Anota las dos URLs (`https://canchaya-api.onrender.com`, `https://canchaya-chat.onrender.com`).
5. Comprueba `https://<api>/health` y `https://<chat>/health`. El primer arranque del monolito corre las migraciones.

## 3. Frontend en Vercel

1. *Add New Project* > importa el repo > **Root Directory: `frontend`**.
2. Variables de entorno:
   - `NEXT_PUBLIC_API_URL` = URL de `canchaya-api`
   - `NEXT_PUBLIC_CHAT_URL` = URL de `canchaya-chat`
3. Despliega y copia la URL (`https://canchaya-xxx.vercel.app`).
4. En Render, en `canchaya-chat`, pon `CHAT_CORS_ORIGIN` = esa URL (sin `/` final) y guarda para que se redespliegue.

## 4. Cargar la demo

```powershell
$env:API_URL="https://canchaya-api.onrender.com"; node scripts/seed-demo.mjs
```

La primera llamada puede tardar un minuto mientras el servicio despierta.

## Limitaciones a tener en cuenta

- **Arranque en frío**: tras 15 min sin uso el primer acceso tarda ~1 min. Abre la demo unos minutos antes de mostrarla.
- **Eventos con retraso**: si el chat está dormido, los eventos esperan en RabbitMQ y se procesan al despertar. Si el monolito está dormido, no publica los suyos hasta despertar.
- **Seguridad**: Next.js 14 tiene avisos pendientes de `npm audit` (ver README). Antes de usar esto con usuarios reales, hay que subir de versión y pasar a pagos reales.
- Estos pasos usan Dockerfiles que compilé y cargué sin Docker en mi entorno; la primera vez que Render los construya es la prueba real.
