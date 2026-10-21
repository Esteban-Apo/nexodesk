import { createHash, randomBytes } from 'node:crypto'
import type { Response } from 'express'

const isProduction = process.env.NODE_ENV === 'production'
const requestedSameSite = (process.env.AUTH_COOKIE_SAME_SITE ?? 'lax').toLowerCase()
if (!['lax', 'strict', 'none'].includes(requestedSameSite)) {
  throw new Error('AUTH_COOKIE_SAME_SITE debe ser lax, strict o none.')
}
if (requestedSameSite === 'none' && !isProduction) {
  throw new Error('AUTH_COOKIE_SAME_SITE=none requiere HTTPS y solo está permitido en producción.')
}
const configuredOrigins = (process.env.CORS_ORIGINS ?? (isProduction ? '' : 'http://localhost:5173'))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

if (isProduction && configuredOrigins.length === 0) {
  throw new Error('CORS_ORIGINS debe definir los orígenes de la aplicación en producción.')
}
for (const origin of configuredOrigins) {
  let parsedOrigin: URL
  try {
    parsedOrigin = new URL(origin)
  } catch {
    throw new Error('Cada valor de CORS_ORIGINS debe ser un origen HTTP o HTTPS válido.')
  }
  if (
    origin === '*' ||
    parsedOrigin.origin !== origin ||
    !['http:', 'https:'].includes(parsedOrigin.protocol) ||
    (isProduction && parsedOrigin.protocol !== 'https:')
  ) {
    throw new Error('CORS_ORIGINS debe contener orígenes exactos; producción requiere HTTPS.')
  }
}

export const trustedOrigins = new Set(configuredOrigins)
export const sessionCookieName = isProduction ? '__Host-nexodesk_session' : 'nexodesk_session'
export const csrfCookieName = isProduction ? '__Host-nexodesk_csrf' : 'nexodesk_csrf'
export const sessionMaxAgeMs = 14 * 24 * 60 * 60 * 1000

const cookieBaseOptions = {
  path: '/',
  sameSite: requestedSameSite as 'lax' | 'strict' | 'none',
  secure: isProduction,
}

export function isTrustedOrigin(origin: string | undefined): boolean {
  return origin !== undefined && trustedOrigins.has(origin)
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

export function setAuthCookies(response: Response, sessionToken: string, csrfToken: string): void {
  response.cookie(sessionCookieName, sessionToken, {
    ...cookieBaseOptions,
    httpOnly: true,
    maxAge: sessionMaxAgeMs,
  })
  response.cookie(csrfCookieName, csrfToken, {
    ...cookieBaseOptions,
    httpOnly: true,
    maxAge: sessionMaxAgeMs,
  })
}

export function setCsrfCookie(response: Response, csrfToken: string): void {
  response.cookie(csrfCookieName, csrfToken, {
    ...cookieBaseOptions,
    httpOnly: true,
    maxAge: sessionMaxAgeMs,
  })
}

export function clearAuthCookies(response: Response): void {
  response.clearCookie(sessionCookieName, { ...cookieBaseOptions, httpOnly: true })
  response.clearCookie(csrfCookieName, { ...cookieBaseOptions, httpOnly: true })
}

export function readCookie(header: string | undefined, cookieName: string): string | undefined {
  if (!header) return undefined

  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return undefined
    }
  }

  return undefined
}

export function logAuthError(operation: string, error: unknown): void {
  const record = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {}
  const name = typeof record.name === 'string' ? record.name : 'UnknownError'
  const message = typeof record.message === 'string' ? record.message : 'Unknown error'
  const code = typeof record.code === 'string' && /^P\d{4}$/.test(record.code) ? record.code : undefined
  const sanitizedMessage = message
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"']+/gi, '[connection string redacted]')
    .replace(/\b(password|passwd|cookie|set-cookie|csrf(?:[_-]?token)?|session(?:[_-]?token)?|token|secret|authorization|api[_-]?key)(?:[_-]?hash)?\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\$argon2(?:id|i|d)\$[^\s"']+/gi, '[password hash redacted]')
    .replace(/\b[A-Za-z0-9_-]{43}\b/g, '[token redacted]')
    .slice(0, 1000)
  console.error(`Error en ${operation}:`, { name: name.slice(0, 100), message: sanitizedMessage, ...(code ? { prismaCode: code } : {}) })
}
