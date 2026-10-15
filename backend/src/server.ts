import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();

const PORT = Number(process.env.PORT) || 3000;

// Middlewares: preparan las solicitudes antes de llegar a las rutas.
app.use(cors({
  origin: 'http://localhost:5173',
}));

app.use(express.json());

// Endpoint de comprobación del servidor.
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'nexodesk-api',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`NexoDesk API ejecutándose en http://localhost:${PORT}`);
});
