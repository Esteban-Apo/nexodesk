import { Prisma, UserRole } from '../generated/prisma/client.js'
import type { AuthContext } from '../types/express.js'

export const TICKET_CREATION_ROLES = [UserRole.REQUESTER, UserRole.ADMIN] as const
export const TICKET_STATUS_ROLES = [UserRole.TECHNICIAN, UserRole.ADMIN] as const

/**
 * Authorization policy for ticket reads:
 * - REQUESTER sees only tickets created by their authenticated account.
 * - TECHNICIAN sees the provisional shared support queue (tickets with a creator).
 *   The schema has no assignment relation; legacy tickets without a creator stay admin-only.
 * - ADMIN sees every ticket, including historical tickets without a creator.
 */
export function ticketVisibilityWhere(auth: AuthContext): Prisma.TicketWhereInput {
  switch (auth.role) {
    case UserRole.REQUESTER:
      return { createdById: auth.userId }
    case UserRole.TECHNICIAN:
      return { createdById: { not: null } }
    case UserRole.ADMIN:
      return {}
    default:
      return assertNever(auth.role)
  }
}

function assertNever(value: never): never {
  throw new Error(`Rol no contemplado en la política de tickets: ${String(value)}`)
}
