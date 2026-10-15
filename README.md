# NexoDesk

NexoDesk es una aplicación Full Stack para gestionar incidentes y solicitudes de soporte técnico. El repositorio separa la aplicación web (`frontend/`), la API (`backend/`) y la documentación (`docs/`).

## Requisitos

- Node.js y npm.

## Ejecutar el frontend

```bash
cd frontend
npm run dev
```

Vite sirve la aplicación de desarrollo (por defecto en `http://localhost:5173`).

## Ejecutar el backend

En otra terminal:

```bash
cd backend
npm run dev
```

El servidor Express usa el puerto definido por `PORT` o `3000` si no se define. La ruta implementada para comprobar el servicio es `GET /api/health`.

Para compilar y ejecutar la salida compilada:

```bash
cd backend
npm run build
npm start
```

## Compilar

```bash
cd frontend
npm run build

cd ../backend
npm run build
```

## Estado y documentación

Consulta [docs/development-status.md](docs/development-status.md) para las funcionalidades implementadas, las verificaciones realizadas y el trabajo pendiente.
