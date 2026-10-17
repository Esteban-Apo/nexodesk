# Estado de desarrollo

Última revisión: 16 de octubre de 2026.

## Implementado

- Frontend React, TypeScript y Vite con indicador de salud de la API; no hay todavía flujos de soporte implementados.
- Frontend consulta `GET /api/health` y muestra los estados de comprobación, API disponible y error de conexión; al responder correctamente presenta el servicio y la hora de la última comprobación, con acción para reintentar.
- URL de la API configurable mediante `VITE_API_URL`, con valor predeterminado documentado `http://localhost:3000` en `frontend/.env.example` y `frontend/README.md`. No se incluyen secretos en variables `VITE_*`.
- Backend Express con TypeScript y configuración de módulos ES.
- Middlewares `cors` (origen permitido: `http://localhost:5173`) y `express.json()`.
- Endpoint `GET /api/health`, que responde con `status`, `service` y una marca de tiempo ISO.
- Scripts del backend: `dev` (`tsx watch`), `build` (`tsc`) y `start` (`node dist/server.js`).
- Dependencias instaladas en ambas carpetas y archivos de lock npm presentes.

## Verificaciones realizadas

- `npm run build` en `backend/`: completó TypeScript sin errores.
- `npm run build` en `frontend/`: completó TypeScript y Vite sin errores.
- 16 de octubre: `npm run build` en ambos proyectos completó correctamente tras implementar el indicador de salud.
- La llamada frontend valida el estado HTTP y la estructura del JSON. La cancelación con `AbortController` evita actualizar React después de desmontar el componente.
- No se pudo verificar el flujo entre frontend y backend desde el navegador en este entorno: `npm run dev` del frontend recibió `EPERM` al enlazar `127.0.0.1:5173`, y el modo `tsx watch` del backend recibió `EPERM` al crear su socket IPC en `/tmp/tsx-1000`.
- Por tanto, el resultado `HTTP 200` de `/api/health` registrado abajo prueba la ruta del backend de forma independiente; no prueba la integración desde el navegador.
- `npm run dev` en `backend/`, ejecutado con permisos elevados: inició y mostró el mensaje de que la API se ejecuta en el puerto 3000.
- `curl --max-time 5 -i http://localhost:3000/api/health`, ejecutado con permisos elevados: respondió `HTTP/1.1 200 OK` y el JSON esperado (`status: ok`, `service: nexodesk-api`, `timestamp` ISO).
- Sin permisos elevados, `npm run dev` del backend recibió `EPERM` al crear su socket IPC bajo `/tmp/tsx-1000`, y la petición HTTP no pudo abrir el socket local. Esto corresponde a las restricciones de aislamiento del entorno, no a un error observado de Express ni de la ruta.
- No hay verificaciones automatizadas configuradas para la lógica del producto.

## Pendiente

- Probar localmente el flujo completo en el navegador: iniciar backend y frontend, y verificar tanto el estado disponible como el error cuando la API no está accesible.
- Diseñar e implementar la interfaz y los flujos de tickets, usuarios, prioridades, estados, asignaciones, comentarios e historial.
- Definir autenticación y autorización seguras en el backend antes de exponer operaciones protegidas.
- Integrar PostgreSQL y Prisma posteriormente; todavía no están configurados.
- Definir y añadir pruebas automatizadas.
