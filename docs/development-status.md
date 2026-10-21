# Estado de desarrollo

Última revisión: 20 de octubre de 2026.

## Implementado

- Frontend React, TypeScript y Vite con pantalla de soporte para crear y consultar tickets, además del indicador de salud de la API.
- Frontend consulta `GET /api/health` y muestra los estados de comprobación, API disponible y error de conexión; al responder correctamente presenta el servicio y la hora de la última comprobación, con acción para reintentar.
- URL de la API configurable mediante `VITE_API_URL`, con valor predeterminado documentado `http://localhost:3000` en `frontend/.env.example` y `frontend/README.md`. No se incluyen secretos en variables `VITE_*`.
- Pantalla responsive de tickets: formulario validado con prioridades reales del backend, confirmación con código del servidor, listado ordenado por la API y estados de carga, error y lista vacía.
- Cliente HTTP y tipos de tickets separados en `frontend/src/services/` y `frontend/src/types/`; valida las respuestas, centraliza `VITE_API_URL` y cancela solicitudes al desmontar.
- Detalle accesible en `/tickets/:code`, con navegación mediante History API, carga directa desde la API, estados de carga/error/no encontrado, y resumen e información completa del ticket.
- Backend Express con TypeScript y configuración de módulos ES.
- Prisma ORM 7.10.1 configurado con PostgreSQL, URL `DATABASE_URL`, generación explícita de Prisma Client y adaptador `pg` reutilizable.
- Modelo `Ticket` con estados/prioridades enum. La migración inicial fue aplicada previamente según la confirmación del usuario.
- Rutas `POST /api/tickets` y `GET /api/tickets`: validación, persistencia Prisma, orden descendente, selección explícita de campos y máximo de 50 resultados.
- `GET /api/tickets/:code`: búsqueda por el campo único `code`, respuesta completa del ticket o HTTP 404 si no existe.
- `PATCH /api/tickets/:code/status`: valida transiciones y actualiza el ticket junto con su actividad en una transacción. Las transiciones son `OPEN → IN_PROGRESS`, `IN_PROGRESS → OPEN/RESOLVED` y `RESOLVED → IN_PROGRESS`; `CLOSED` no admite transiciones nuevas.
- Modelo `TicketActivity` para persistir los cambios de estado. La migración `20261020120000_ticket_status_activity` crea tabla, índice y relación con borrado en cascada, e inicializa el historial de tickets existentes.
- Los tickets nuevos registran su estado inicial `OPEN`. El detalle de la API incluye el historial cronológico; React ofrece acciones según el estado y muestra la actividad en español.
- Código público `NX-000001` asignado mediante secuencia PostgreSQL atómica y respaldado por la restricción única de `Ticket.code`.
- Las rutas de tickets registran en el servidor el nombre, mensaje saneado y códigos seguros de Prisma/PostgreSQL ante fallos; las respuestas HTTP mantienen mensajes genéricos.
- Middlewares `cors` (origen permitido: `http://localhost:5173`) y `express.json()`.
- Endpoint `GET /api/health`, que responde con `status`, `service` y una marca de tiempo ISO.
- Scripts del backend: `dev` (`tsx watch`), `build` (`tsc`), `start` (`node dist/server.js`), `prisma:generate` y `prisma:migrate`.
- Dependencias instaladas en ambas carpetas y archivos de lock npm presentes.

## Verificaciones realizadas

- `prisma validate` con una URL local de ejemplo: esquema válido.
- `npm run prisma:generate` con URL de ejemplo: Prisma Client 7.10.1 generado en `backend/src/generated/prisma`.
- 18 de octubre, antes de habilitar acceso a los puertos locales: `npm test` compiló y pasó 3 pruebas de validación; omitió 6 pruebas HTTP/de persistencia porque ese entorno no permitía enlazar `127.0.0.1` (`EPERM`). El 19 de octubre pasaron 7 pruebas HTTP/de persistencia con acceso local.
- La migración `20261018120000_ticket_code_sequence` crea la secuencia PostgreSQL utilizada para asignar códigos públicos.
- 18 de octubre, bajo restricciones de sandbox, `pg_isready` no obtuvo respuesta en `localhost:5433`; el 19 de octubre se consultó la base y se aplicó la migración de secuencia pendiente.
- `npm run build` en `backend/` y `git diff --check`: completaron sin errores.
- npm reportó cero vulnerabilidades durante la instalación de Prisma 7.10.1. Un `npm audit` posterior no pudo contactar el registro npm por un fallo DNS del entorno.
- 20 de octubre: `npm run prisma:generate` y `npx prisma validate --config prisma7.config.ts` finalizaron correctamente.
- 20 de octubre: `npm run build` del backend y frontend, `npm run lint` del frontend y `git diff --check` finalizaron sin errores.
- 20 de octubre: `npx prisma migrate deploy --config prisma7.config.ts` aplicó `20261020120000_ticket_status_activity` en PostgreSQL (`nexodesk`, `localhost:5433`).
- 20 de octubre: `npm test` pasó 3 pruebas de validación y 7 de integración, sin fallos ni omisiones. Se probaron transiciones permitidas y rechazadas, historial persistido, estado inválido y ticket inexistente.

- `npm run build` en `backend/`: completó TypeScript sin errores.
- `npm run build` en `frontend/`: completó TypeScript y Vite sin errores.
- 19 de octubre: tras implementar la interfaz funcional, `npm run build` y `npm run lint` de `frontend/` finalizaron sin errores; `npm run build` del backend y `git diff --check` también pasaron.
- En la etapa anterior, el navegador devolvió `ERR_CONNECTION_REFUSED` al intentar acceder a Vite; en esta etapa, el 19 de octubre, sí se comprobó la vista de detalle en el navegador.
- Prueba visual/HTTP del 19 de octubre: se abrió `NX-000004`, se verificaron los campos del detalle y la salud verde; después de recargar la URL directa volvió a cargar el ticket, el código inexistente mostró el estado 404 y el botón de regreso abrió el listado.
- `npm test` del backend, 19 de octubre: pasaron las 3 pruebas de validación y las 7 pruebas HTTP/de PostgreSQL (10 en total), sin fallos ni omisiones. Incluyó detalle existente, detalle inexistente, creación, listado y salud; las pruebas limpiaron sus tickets temporales.
- 16 de octubre: `npm run build` en ambos proyectos completó correctamente tras implementar el indicador de salud.
- La llamada frontend valida el estado HTTP y la estructura del JSON. La cancelación con `AbortController` evita actualizar React después de desmontar el componente.
- No se pudo verificar el flujo entre frontend y backend desde el navegador en este entorno: `npm run dev` del frontend recibió `EPERM` al enlazar `127.0.0.1:5173`, y el modo `tsx watch` del backend recibió `EPERM` al crear su socket IPC en `/tmp/tsx-1000`.
- Por tanto, el resultado `HTTP 200` de `/api/health` registrado abajo prueba la ruta del backend de forma independiente; no prueba la integración desde el navegador.
- `npm run dev` en `backend/`, ejecutado con permisos elevados: inició y mostró el mensaje de que la API se ejecuta en el puerto 3000.
- `curl --max-time 5 -i http://localhost:3000/api/health`, ejecutado con permisos elevados: respondió `HTTP/1.1 200 OK` y el JSON esperado (`status: ok`, `service: nexodesk-api`, `timestamp` ISO).
- Sin permisos elevados, `npm run dev` del backend recibió `EPERM` al crear su socket IPC bajo `/tmp/tsx-1000`, y la petición HTTP no pudo abrir el socket local. Esto corresponde a las restricciones de aislamiento del entorno, no a un error observado de Express ni de la ruta.
- No hay pruebas automatizadas configuradas para el frontend.

## Pendiente

- Implementar usuarios, asignaciones y comentarios.
- Definir autenticación y autorización seguras en el backend antes de exponer operaciones protegidas.

## Diagnóstico de POST /api/tickets — 19 de octubre de 2026

- La inspección de solo lectura a `localhost:5433` encontró la tabla `Ticket` (0 filas), pero no encontró `public.ticket_code_seq`; la migración `20261018120000_ticket_code_sequence` tampoco estaba registrada como aplicada.
- La causa del HTTP 500 era el `nextval` de esa secuencia inexistente, que ocurre antes de crear el ticket con Prisma. No se observaron indicios de incompatibilidad entre el modelo `Ticket` y la tabla en esta comprobación.
- Se aplicó con `prisma migrate deploy --config prisma7.config.ts` la migración existente, que solo crea y posiciona la secuencia. Prisma confirmó que se aplicó correctamente; no se cambió el esquema Prisma ni se creó otra migración.
- `POST` y `GET` ahora registran nombre y mensaje saneado de excepciones y códigos Prisma/PostgreSQL con formato reconocido. Las respuestas al cliente siguen siendo genéricas y no incluyen detalles internos.
- `npm test` se ejecutó con acceso a los puertos locales y PostgreSQL: pasaron las 3 pruebas de validación y las 6 pruebas HTTP/de base de datos, incluyendo POST, persistencia, GET, salud y dos solicitudes concurrentes; no hubo pruebas omitidas.
- Las pruebas eliminan los tickets temporales que crean. No quedó pendiente una comprobación de integración para esta etapa.

## Vista de detalle de tickets — 19 de octubre de 2026

- El backend expone `GET /api/tickets/:code`; reusa la instancia Prisma y la selección de todos los campos del ticket. Responde 404 con mensaje controlado si el código no existe.
- El frontend usa enlaces accesibles y `history.pushState`/`popstate`, sin dependencias de router. Las URL `/tickets/NX-000004` también cargan el detalle tras recargar porque la vista consulta la API por código.
- La pantalla presenta código, título, estado, prioridad, descripción completa, identificador y ambas fechas en español. Los estados y prioridades se traducen solo en la presentación.
- `npm run build` y `npm run lint` en `frontend/`, `npm run build` en `backend/` y `git diff --check` finalizaron sin errores.
- Se verificó en navegador un ticket existente, la carga directa tras recargar, el 404 visual para un código inexistente y el regreso al listado.

## Ciclo de vida e historial de tickets — 20 de octubre de 2026

- El backend responde HTTP 400 para estados inválidos, HTTP 404 para tickets inexistentes y HTTP 409 para transiciones no permitidas o conflictos concurrentes.
- Cada cambio y su registro se guardan juntos. El historial conserva estado anterior, estado nuevo y fecha; hay un evento inicial para tickets existentes y nuevos.
- El detalle React muestra las acciones válidas, errores de actualización y una línea cronológica en español, manteniendo la interfaz existente.
- La migración aditiva se aplicó a la base configurada. Conserva el enum existente, incluida la compatibilidad con `CLOSED`.
- Builds, lint, pruebas y validación Prisma de esta etapa están registrados en «Verificaciones realizadas».
