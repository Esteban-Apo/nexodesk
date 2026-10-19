import { Router, type Request, type Response } from 'express'
import { Prisma, TicketPriority } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'

type TicketInput = {
  title: string
  description: string
  priority: TicketPriority
}

type TicketInputResult =
  | { valid: true; value: TicketInput }
  | { valid: false; error: string }

const allowedPriorities = new Set<string>(Object.values(TicketPriority))
const serverManagedFields = ['id', 'code', 'status', 'createdAt', 'updatedAt'] as const
const ticketSelect = {
  id: true,
  code: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TicketSelect

function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === 'string' && allowedPriorities.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function redactSensitiveDetails(message: string): string {
  return message
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, '[connection string redacted]')
    .replace(/\b(password|passwd|token|secret|authorization|api[_-]?key)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 1000)
}

function logDatabaseError(operation: string, error: unknown): void {
  const name = isRecord(error) && typeof error.name === 'string' ? error.name : 'UnknownError'
  const message = isRecord(error) && typeof error.message === 'string' ? error.message : 'Unknown error'
  const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
  const meta = isRecord(error) && isRecord(error.meta) ? error.meta : undefined
  const databaseCode = meta && typeof meta.code === 'string' ? meta.code : undefined
  const details: Record<string, string> = {
    name: redactSensitiveDetails(name),
    message: redactSensitiveDetails(message),
  }

  if (code && /^P\d{4}$/.test(code)) details.prismaCode = code
  if (databaseCode && /^[0-9A-Z]{5}$/.test(databaseCode)) details.databaseCode = databaseCode
  else if (code && /^[0-9A-Z]{5}$/.test(code)) details.databaseCode = code

  console.error(`Error en ${operation}:`, details)
}

export function validateTicketInput(input: unknown): TicketInputResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { valid: false, error: 'El cuerpo debe ser un objeto JSON.' }
  }

  const body = input as Record<string, unknown>
  if (serverManagedFields.some((field) => Object.hasOwn(body, field))) {
    return { valid: false, error: 'id, code, status y fechas son administrados por el servidor.' }
  }

  const unknownFields = Object.keys(body).filter(
    (field) => !['title', 'description', 'priority'].includes(field),
  )
  if (unknownFields.length > 0) {
    return { valid: false, error: 'El cuerpo contiene campos no permitidos.' }
  }

  if (typeof body.title !== 'string' || body.title.trim().length === 0) {
    return { valid: false, error: 'title es obligatorio y debe ser una cadena no vacía.' }
  }

  const title = body.title.trim()
  if ([...title].length > 200) {
    return { valid: false, error: 'title no puede superar los 200 caracteres.' }
  }

  if (typeof body.description !== 'string' || body.description.trim().length === 0) {
    return {
      valid: false,
      error: 'description es obligatorio y debe ser una cadena no vacía.',
    }
  }

  const description = body.description.trim()
  const priority = body.priority === undefined ? TicketPriority.MEDIUM : body.priority
  if (!isTicketPriority(priority)) {
    return {
      valid: false,
      error: `priority debe ser uno de estos valores: ${[...allowedPriorities].join(', ')}.`,
    }
  }

  return {
    valid: true,
    value: {
      title,
      description,
      priority,
    },
  }
}

const ticketsRouter = Router()

ticketsRouter.post(
  '/',
  async (
    req: Request<Record<string, never>, unknown, unknown>,
    res: Response<unknown>,
  ) => {
    const validation = validateTicketInput(req.body)
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error })
    }

    try {
      const [sequenceValue] = await prisma.$queryRaw<Array<{ value: string }>>`
        SELECT nextval('"public"."ticket_code_seq"')::text AS value
      `
      const code = `NX-${sequenceValue.value.padStart(6, '0')}`
      const ticket = await prisma.ticket.create({
        data: {
          ...validation.value,
          code,
        },
        select: ticketSelect,
      })

      return res.status(201).json(ticket)
    } catch (error: unknown) {
      logDatabaseError('POST /api/tickets', error)
      return res.status(500).json({ error: 'No se pudo crear el ticket.' })
    }
  },
)

ticketsRouter.get(
  '/',
  async (
    _req: Request<Record<string, never>, unknown, unknown>,
    res: Response<unknown>,
  ) => {
    try {
      const tickets = await prisma.ticket.findMany({
        select: ticketSelect,
        orderBy: { createdAt: 'desc' },
        take: 50,
      })

      return res.status(200).json(tickets)
    } catch (error: unknown) {
      logDatabaseError('GET /api/tickets', error)
      return res.status(500).json({ error: 'No se pudieron consultar los tickets.' })
    }
  },
)

export default ticketsRouter
