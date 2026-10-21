import { randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import { Router, type RequestHandler } from 'express'
import { UserRole } from '../generated/prisma/client.js'
import {
  clearAuthCookies,
  createOpaqueToken,
  csrfCookieName,
  hashOpaqueToken,
  logAuthError,
  readCookie,
  sessionMaxAgeMs,
  setAuthCookies,
  setCsrfCookie,
} from '../auth/security.js'
import { requireAuth, requireCsrf, requireTrustedOrigin } from '../middleware/auth.js'
import { prisma } from '../lib/prisma.js'

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const
const MAX_LOGIN_FAILURES = 8
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_IPS = 10_000
const loginFailures = new Map<string, { count: number; resetAt: number }>()
let dummyPasswordHash: Promise<string> | undefined

type SafeUser = {
  id: string
  name: string
  email: string
  role: UserRole
}

function safeUser(user: SafeUser): SafeUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS)
  return dummyPasswordHash
}

function clientAddress(request: Parameters<RequestHandler>[0]): string {
  return request.ip || request.socket.remoteAddress || 'unknown'
}

const enforceLoginLimit: RequestHandler = (request, response, next) => {
  const now = Date.now()
  for (const [address, record] of loginFailures) {
    if (record.resetAt <= now) loginFailures.delete(address)
  }

  const address = clientAddress(request)
  let record = loginFailures.get(address)
  if (record?.resetAt && record.resetAt <= now) {
    loginFailures.delete(address)
    record = undefined
  }
  if (record && record.count >= MAX_LOGIN_FAILURES) {
    response.setHeader('Retry-After', String(Math.ceil((record.resetAt - now) / 1000)))
    response.status(429).json({ error: 'No se pudo iniciar sesión. Intenta de nuevo más tarde.' })
    return
  }
  if (!record && loginFailures.size >= MAX_LOGIN_IPS) {
    response.status(429).json({ error: 'No se pudo iniciar sesión. Intenta de nuevo más tarde.' })
    return
  }
  next()
}

function recordLoginFailure(address: string): void {
  const now = Date.now()
  const current = loginFailures.get(address)
  if (current && current.resetAt > now) current.count += 1
  else loginFailures.set(address, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
}

function clearLoginFailures(address: string): void {
  loginFailures.delete(address)
}

const router = Router()

router.use((_request, response, next) => {
  response.setHeader('Cache-Control', 'no-store')
  next()
})

router.post('/login', requireTrustedOrigin, enforceLoginLimit, async (request, response) => {
  if (
    !isRecord(request.body) ||
    typeof request.body.email !== 'string' ||
    typeof request.body.password !== 'string'
  ) {
    response.status(400).json({ error: 'Ingresa un correo y una contraseña válidos.' })
    return
  }

  const email = request.body.email.trim().toLowerCase()
  const password = request.body.password
  if (
    email.length === 0 || Buffer.byteLength(email, 'utf8') > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length === 0 || Buffer.byteLength(password, 'utf8') > 1024
  ) {
    response.status(400).json({ error: 'Ingresa un correo y una contraseña válidos.' })
    return
  }

  const address = clientAddress(request)
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    })

    const hash = user?.passwordHash ?? await getDummyPasswordHash()
    const passwordMatches = await argon2.verify(hash, password)
    if (!user || !user.isActive || !user.passwordHash || !passwordMatches) {
      recordLoginFailure(address)
      response.status(401).json({ error: 'Correo o contraseña incorrectos.' })
      return
    }

    const sessionToken = createOpaqueToken()
    const csrfToken = createOpaqueToken()
    const now = new Date()
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashOpaqueToken(sessionToken),
        csrfTokenHash: hashOpaqueToken(csrfToken),
        expiresAt: new Date(now.getTime() + sessionMaxAgeMs),
      },
    })

    setAuthCookies(response, sessionToken, csrfToken)
    clearLoginFailures(address)
    response.status(200).json({ user: safeUser(user), csrfToken })
  } catch (error: unknown) {
    logAuthError('POST /api/auth/login', error)
    response.status(500).json({ error: 'No se pudo iniciar sesión.' })
  }
})

router.get('/me', requireAuth, async (request, response) => {
  const auth = request.auth
  if (!auth) {
    response.status(401).json({ error: 'Se requiere una sesión válida.' })
    return
  }

  try {
    let csrfToken = readCookie(request.headers.cookie, csrfCookieName)
    if (!csrfToken || hashOpaqueToken(csrfToken) !== auth.csrfTokenHash) {
      csrfToken = createOpaqueToken()
      await prisma.session.update({
        where: { id: auth.sessionId },
        data: { csrfTokenHash: hashOpaqueToken(csrfToken) },
      })
      setCsrfCookie(response, csrfToken)
    }

    response.status(200).json({
      user: safeUser({ id: auth.userId, name: auth.name, email: auth.email, role: auth.role }),
      csrfToken,
    })
  } catch (error: unknown) {
    logAuthError('GET /api/auth/me', error)
    response.status(500).json({ error: 'No se pudo consultar la sesión.' })
  }
})

router.post('/logout', requireAuth, requireCsrf, async (request, response) => {
  const sessionId = request.auth?.sessionId
  if (!sessionId) {
    response.status(401).json({ error: 'Se requiere una sesión válida.' })
    return
  }

  try {
    await prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    clearAuthCookies(response)
    response.status(204).end()
  } catch (error: unknown) {
    logAuthError('POST /api/auth/logout', error)
    response.status(500).json({ error: 'No se pudo cerrar la sesión.' })
  }
})

export default router
