import { emitKeypressEvents } from 'node:readline'
import { createInterface } from 'node:readline/promises'
import argon2 from 'argon2'
import { UserRole } from '../generated/prisma/client.js'
import { logAuthError } from '../auth/security.js'
import { prisma } from '../lib/prisma.js'

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
} as const

class AdminSetupError extends Error {}

function readHidden(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    return Promise.reject(new AdminSetupError('La creación del administrador requiere una terminal interactiva.'))
  }

  emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdout.write(prompt)

  return new Promise((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      process.stdin.off('keypress', onKeypress)
      process.stdin.setRawMode(false)
      process.stdout.write('\n')
    }
    const onKeypress = (character: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup()
        reject(new Error('Operación cancelada.'))
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        cleanup()
        resolve(value)
        return
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1)
        process.stdout.write('\b \b')
        return
      }
      if (character && !key.ctrl && character >= ' ') {
        value += character
        process.stdout.write('*')
      }
    }
    process.stdin.on('keypress', onKeypress)
  })
}

async function createFirstAdministrator(): Promise<void> {
  if (!process.stdin.isTTY) throw new AdminSetupError('La creación del administrador requiere una terminal interactiva.')

  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  const name = (await terminal.question('Nombre del administrador: ')).trim()
  const email = (await terminal.question('Correo del administrador: ')).trim().toLowerCase()
  terminal.close()

  if (name.length === 0 || [...name].length > 120) throw new AdminSetupError('El nombre debe tener entre 1 y 120 caracteres.')
  if (
    Buffer.byteLength(email, 'utf8') > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new AdminSetupError('Ingresa una dirección de correo válida.')
  }

  const password = await readHidden('Contraseña (mínimo 12 caracteres): ')
  const confirmation = await readHidden('Repite la contraseña: ')
  if ([...password].length < 12 || Buffer.byteLength(password, 'utf8') > 1024) {
    throw new AdminSetupError('La contraseña debe tener entre 12 caracteres y 1024 bytes.')
  }
  if (password !== confirmation) throw new AdminSetupError('Las contraseñas no coinciden.')

  const passwordHash = await argon2.hash(password, ARGON2_OPTIONS)
  await prisma.$transaction(async (transaction) => {
    // Prisma cannot deserialize PostgreSQL's `void` return value from the lock function.
    await transaction.$queryRaw<Array<{ lock: string }>>`
      SELECT pg_advisory_xact_lock(183624091)::text AS lock
    `
    if (await transaction.user.count() !== 0) {
      throw new AdminSetupError('Ya existe al menos un usuario; este comando solo crea el primer administrador.')
    }

    await transaction.user.create({
      data: { name, email, passwordHash, role: UserRole.ADMIN, isActive: true },
    })
  })

  process.stdout.write(`Se creó el administrador ${email}.\n`)
}

try {
  await createFirstAdministrator()
} catch (error: unknown) {
  if (!(error instanceof AdminSetupError)) logAuthError('auth:create-admin', error)
  const message = error instanceof AdminSetupError
    ? error.message
    : 'Error interno. Revisa la conexión configurada y que no exista ya un administrador.'
  process.stderr.write(`No se pudo crear el administrador inicial: ${message}\n`)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
