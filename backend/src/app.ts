import express from 'express'
import cors from 'cors'
import ticketsRouter from './routes/tickets.js'

export const app = express()

app.use(
  cors({
    origin: 'http://localhost:5173',
  }),
)

app.use(express.json())

// Endpoint de comprobación existente; su respuesta se mantiene intacta.
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'nexodesk-api',
    timestamp: new Date().toISOString(),
  })
})

app.use('/api/tickets', ticketsRouter)
