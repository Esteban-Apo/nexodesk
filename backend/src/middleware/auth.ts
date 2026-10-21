import { createHash, timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { UserRole } from '../generated/prisma/client.js'
import { prisma } from '../lib/prisma.js'
import { isTrustedOrigin, logAuthError, readCookie, sessionCookieName } from '../auth/security.js'

export const requireAuth: RequestHandler = async (request, response, next) => {
  const token = readCookie(request.headers.cookie, sessionCookieName)
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    response.status(401).json({ error: 'Se requiere una sesión válida.' })
    return
  }

  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: createHash('sha256').update(token, 'utf8').digest('hex') },
      select: {
        id: true,
        csrfTokenHash: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      },
    })

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      response.status(401).json({ error: 'Se requiere una sesión válida.' })
      return
    }

    if (!session.user.isActive) {
      await prisma.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      response.status(401).json({ error: 'Se requiere una sesión válida.' })
      return
    }

    request.auth = {
      userId: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      sessionId: session.id,
      csrfTokenHash: session.csrfTokenHash,
    }
    next()
  } catch (error: unknown) {
    logAuthError('validación de sesión', error)
    response.status(500).json({ error: 'No se pudo validar la sesión.' })
  }
}

export const requireTrustedOrigin: RequestHandler = (request, response, next) => {
  const origin = request.get('origin')
  if (!isTrustedOrigin(origin)) {
    response.status(403).json({ error: 'El origen de la solicitud no está permitido.' })
    return
  }
  next()
}

export function requireRoles(...allowedRoles: UserRole[]): RequestHandler {
  return (request, response, next) => {
    if (!request.auth) {
      response.status(401).json({ error: 'Se requiere una sesión válida.' })
      return
    }

    if (!allowedRoles.includes(request.auth.role)) {
      response.status(403).json({ error: 'No tienes permiso para realizar esta operación.' })
      return
    }

    next()
  }
}

export const requireCsrf: RequestHandler = (request, response, next) => {
  const auth = request.auth
  const token = request.get('x-csrf-token')
  const origin = request.get('origin')

  if (!auth || !isTrustedOrigin(origin) || !token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    response.status(403).json({ error: 'La solicitud no superó la validación de seguridad.' })
    return
  }

  const providedHash = createHash('sha256').update(token, 'utf8').digest()
  const expectedHash = Buffer.from(auth.csrfTokenHash, 'hex')
  if (expectedHash.length !== providedHash.length || !timingSafeEqual(providedHash, expectedHash)) {
    response.status(403).json({ error: 'La solicitud no superó la validación de seguridad.' })
    return
  }

  next()
}
