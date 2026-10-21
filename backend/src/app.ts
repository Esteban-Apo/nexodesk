import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import authRouter from './routes/auth.js'
import ticketsRouter from './routes/tickets.js'
import { trustedOrigins } from './auth/security.js'

export const app = express()

app.use(
  cors({
    origin(origin, callback) {
      if (origin && trustedOrigins.has(origin)) callback(null, origin)
      else callback(null, false)
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  }),
)

app.use(express.json({ limit: '32kb' }))

// Endpoint de comprobación existente; su respuesta se mantiene intacta.
app.get('/api/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'nexodesk-api',
    timestamp: new Date().toISOString(),
  })
})

app.use('/api/auth', authRouter)
app.use('/api/tickets', ticketsRouter)
