import { Router, type Request, type Response } from 'express'
import { Prisma, TicketPriority, TicketStatus } from '../generated/prisma/client.js'
import { TICKET_CREATION_ROLES, TICKET_STATUS_ROLES, ticketVisibilityWhere } from '../auth/authorization.js'
import { prisma } from '../lib/prisma.js'
import { requireAuth, requireCsrf, requireRoles } from '../middleware/auth.js'

type TicketInput = {
  title: string
  description: string
  priority: TicketPriority
}

type TicketInputResult =
  | { valid: true; value: TicketInput }
  | { valid: false; error: string }

const allowedPriorities = new Set<string>(Object.values(TicketPriority))
const allowedStatuses = new Set<string>(Object.values(TicketStatus))
const validStatusTransitions: Record<TicketStatus, readonly TicketStatus[]> = {
  [TicketStatus.OPEN]: [TicketStatus.IN_PROGRESS],
  [TicketStatus.IN_PROGRESS]: [TicketStatus.OPEN, TicketStatus.RESOLVED],
  [TicketStatus.RESOLVED]: [TicketStatus.IN_PROGRESS],
  [TicketStatus.CLOSED]: [],
}
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
const ticketDetailSelect = {
  ...ticketSelect,
  activities: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, fromStatus: true, toStatus: true, createdAt: true },
  },
} satisfies Prisma.TicketSelect

function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === 'string' && allowedPriorities.has(value)
}

function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && allowedStatuses.has(value)
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

// Todas las operaciones de tickets, incluida su lectura, requieren una sesión.
ticketsRouter.use(requireAuth)

ticketsRouter.post(
  '/',
  requireCsrf,
  requireRoles(...TICKET_CREATION_ROLES),
  async (
    req: Request<Record<string, never>, unknown, unknown>,
    res: Response<unknown>,
  ) => {
    const authenticatedUserId = req.auth?.userId
    if (!authenticatedUserId) {
      return res.status(401).json({ error: 'Se requiere una sesión válida.' })
    }

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
          createdById: authenticatedUserId,
          activities: { create: { toStatus: TicketStatus.OPEN, actorUserId: authenticatedUserId } },
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
        where: ticketVisibilityWhere(_req.auth!),
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

ticketsRouter.get(
  '/:code',
  async (
    req: Request<{ code: string }, unknown, unknown>,
    res: Response<unknown>,
  ) => {
    try {
      const ticket = await prisma.ticket.findFirst({
        where: { code: req.params.code, ...ticketVisibilityWhere(req.auth!) },
        select: ticketDetailSelect,
      })

      if (!ticket) {
        return res.status(404).json({ error: 'No se encontró el ticket solicitado.' })
      }

      return res.status(200).json(ticket)
    } catch (error: unknown) {
      logDatabaseError('GET /api/tickets/:code', error)
      return res.status(500).json({ error: 'No se pudo consultar el ticket.' })
    }
  },
)

ticketsRouter.patch(
  '/:code/status',
  requireCsrf,
  requireRoles(...TICKET_STATUS_ROLES),
  async (
    req: Request<{ code: string }, unknown, unknown>,
    res: Response<unknown>,
  ) => {
    const authenticatedUserId = req.auth?.userId
    if (!authenticatedUserId) {
      return res.status(401).json({ error: 'Se requiere una sesión válida.' })
    }

    if (!isRecord(req.body) || !isTicketStatus(req.body.status)) {
      return res.status(400).json({
        error: `status debe ser uno de estos valores: ${[...allowedStatuses].join(', ')}.`,
      })
    }

    const nextStatus = req.body.status

    try {
      const result = await prisma.$transaction(async (transaction) => {
        const current = await transaction.ticket.findFirst({
          where: { code: req.params.code, ...ticketVisibilityWhere(req.auth!) },
          select: { id: true, status: true },
        })

        if (!current) return { kind: 'not-found' as const }
        if (!validStatusTransitions[current.status].includes(nextStatus)) {
          return { kind: 'invalid-transition' as const, status: current.status }
        }

        const changed = await transaction.ticket.updateMany({
          where: { id: current.id, status: current.status },
          data: { status: nextStatus },
        })
        if (changed.count !== 1) return { kind: 'conflict' as const }

        await transaction.ticketActivity.create({
          data: {
            ticketId: current.id,
            fromStatus: current.status,
            toStatus: nextStatus,
            actorUserId: authenticatedUserId,
          },
        })
        const ticket = await transaction.ticket.findUnique({
          where: { id: current.id },
          select: ticketDetailSelect,
        })
        return ticket ? { kind: 'updated' as const, ticket } : { kind: 'not-found' as const }
      })

      if (result.kind === 'not-found') {
        return res.status(404).json({ error: 'No se encontró el ticket solicitado.' })
      }
      if (result.kind === 'invalid-transition') {
        return res.status(409).json({
          error: `No se permite cambiar el ticket de ${result.status} a ${nextStatus}.`,
        })
      }
      if (result.kind === 'conflict') {
        return res.status(409).json({ error: 'El ticket cambió de estado. Vuelve a cargarlo e intenta de nuevo.' })
      }

      return res.status(200).json(result.ticket)
    } catch (error: unknown) {
      logDatabaseError('PATCH /api/tickets/:code/status', error)
      return res.status(500).json({ error: 'No se pudo actualizar el estado del ticket.' })
    }
  },
)

export default ticketsRouter
