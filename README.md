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

## PostgreSQL y Prisma (backend)

El backend usa Prisma ORM 7 con PostgreSQL. Para preparar una base de datos local llamada `nexodesk`:

1. Inicia el servicio local de PostgreSQL.
2. Crea la base con `createdb nexodesk`, o desde `psql`/pgAdmin ejecuta `CREATE DATABASE nexodesk;` con un usuario que tenga permiso.
3. Desde `backend/`, copia `.env.example` a `.env` y reemplaza `USER` y `PASSWORD` por las credenciales locales. La URL tiene la forma `postgresql://USUARIO:CONTRASEÑA@localhost:5432/nexodesk?schema=public`. `.env` está excluido de Git.
4. Ejecuta `npm run prisma:generate` para generar Prisma Client y `npm run prisma:migrate` para aplicar las migraciones pendientes en desarrollo.

La migración inicial se encuentra en `backend/prisma/migrations/`. La configuración no aplica migraciones automáticamente al arrancar el backend.

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
