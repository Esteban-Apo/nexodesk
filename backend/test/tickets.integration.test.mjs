import 'dotenv/config'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import argon2 from 'argon2'
import { Client } from 'pg'
import { UserRole } from '../dist/generated/prisma/client.js'
import { app } from '../dist/app.js'
import { prisma } from '../dist/lib/prisma.js'

let server
let baseUrl
let serverAvailable = false
let databaseAvailable = false
const createdTicketIds = []
const createdUserIds = []
const fixturePassword = 'NexoDesk-Test-Only-Password-2026!'
const fixtureEmail = `nexodesk-test-${randomUUID()}@example.test`
const technicianEmail = `nexodesk-technician-${randomUUID()}@example.test`
const adminEmail = `nexodesk-admin-${randomUUID()}@example.test`
let fixtureUser
let technicianUser
let adminUser
const sessionsByRole = {}

before(async () => {
  try {
    server = app.listen(0, '127.0.0.1')
    await once(server, 'listening')
  } catch {
    serverAvailable = false
    return
  }
  serverAvailable = true

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  baseUrl = `http://127.0.0.1:${address.port}`

  const probe = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 1500,
  })

  try {
    await probe.connect()
    await probe.query('SELECT 1')
    databaseAvailable = true
  } catch {
    databaseAvailable = false
  } finally {
    await probe.end().catch(() => undefined)
  }

  if (!databaseAvailable) return

  const passwordHash = await argon2.hash(fixturePassword, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  })
  fixtureUser = await prisma.user.create({
    data: { name: 'Solicitante de prueba', email: fixtureEmail, passwordHash, role: UserRole.REQUESTER },
  })
  createdUserIds.push(fixtureUser.id)
  technicianUser = await prisma.user.create({
    data: { name: 'Técnico de prueba', email: technicianEmail, passwordHash, role: UserRole.TECHNICIAN },
  })
  createdUserIds.push(technicianUser.id)
  adminUser = await prisma.user.create({
    data: { name: 'Administrador de prueba', email: adminEmail, passwordHash, role: UserRole.ADMIN },
  })
  createdUserIds.push(adminUser.id)

  for (const [role, email] of [
    [UserRole.REQUESTER, fixtureEmail],
    [UserRole.TECHNICIAN, technicianEmail],
    [UserRole.ADMIN, adminEmail],
  ]) {
    const loginResponse = await loginAs(email, fixturePassword)
    assert.equal(loginResponse.status, 200)
    sessionsByRole[role] = sessionContext(loginResponse)
  }
})

after(async () => {
  try {
    if (databaseAvailable && createdTicketIds.length > 0) {
      await prisma.ticket.deleteMany({
        where: { id: { in: createdTicketIds } },
      })
    }
    if (databaseAvailable && createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })
    }
  } finally {
    await prisma.$disconnect()
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
})

function cookiePair(cookies, name) {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`))
  assert.ok(cookie, `No se encontró la cookie ${name}.`)
  return cookie.split(';', 1)[0]
}

function cookieValue(pair) {
  return pair.slice(pair.indexOf('=') + 1)
}

function sessionContext(response) {
  const cookies = response.headers.getSetCookie()
  const sessionName = process.env.NODE_ENV === 'production' ? '__Host-nexodesk_session' : 'nexodesk_session'
  const csrfName = process.env.NODE_ENV === 'production' ? '__Host-nexodesk_csrf' : 'nexodesk_csrf'
  const session = cookiePair(cookies, sessionName)
  const csrf = cookiePair(cookies, csrfName)
  return {
    cookie: `${session}; ${csrf}`,
    csrfToken: cookieValue(csrf),
    headers: (extra = {}) => ({
      origin: 'http://localhost:5173',
      cookie: `${session}; ${csrf}`,
      'x-csrf-token': cookieValue(csrf),
      ...extra,
    }),
  }
}

async function loginAs(email, password, extraFields = {}) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify({ email, password, ...extraFields }),
  })
}

function sessionHeaders({ role = UserRole.REQUESTER, csrf = true, ...headers } = {}) {
  const session = sessionsByRole[role]
  return {
    origin: 'http://localhost:5173',
    cookie: session?.cookie ?? '',
    ...(csrf ? { 'x-csrf-token': session?.csrfToken ?? '' } : {}),
    ...headers,
  }
}

async function postTicket(body, { authenticated = true, csrf = true, role = UserRole.REQUESTER } = {}) {
  return fetch(`${baseUrl}/api/tickets`, {
    method: 'POST',
    headers: authenticated
      ? sessionHeaders({ role, csrf, 'content-type': 'application/json' })
      : { 'content-type': 'application/json', origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  })
}

async function patchTicketStatus(code, status, role = UserRole.TECHNICIAN) {
  return fetch(`${baseUrl}/api/tickets/${encodeURIComponent(code)}/status`, {
    method: 'PATCH',
    headers: sessionHeaders({ role, 'content-type': 'application/json' }),
    body: JSON.stringify({ status }),
  })
}

async function getTickets(role = UserRole.REQUESTER) {
  return fetch(`${baseUrl}/api/tickets`, { headers: sessionHeaders({ role, csrf: false }) })
}

async function getTicket(code, role = UserRole.REQUESTER) {
  return fetch(`${baseUrl}/api/tickets/${encodeURIComponent(code)}`, {
    headers: sessionHeaders({ role, csrf: false }),
  })
}

function canRunDatabaseTest(context) {
  if (!serverAvailable) {
    context.skip('El entorno no permite abrir un puerto local para pruebas HTTP.')
    return false
  }

  if (!databaseAvailable) {
    context.skip('PostgreSQL configurado en DATABASE_URL no está disponible.')
    return false
  }

  return true
}

test('GET /api/health sigue respondiendo correctamente', async (context) => {
  if (!serverAvailable) {
    context.skip('El entorno no permite abrir un puerto local para pruebas HTTP.')
    return
  }

  const response = await fetch(`${baseUrl}/api/health`)
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.status, 'ok')
  assert.equal(body.service, 'nexodesk-api')
  assert.ok(Number.isFinite(Date.parse(body.timestamp)))
})

test('login correcto crea una sesión cuyo token no se guarda en claro', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const response = await loginAs(fixtureEmail, fixturePassword)
  const body = await response.json()
  const cookies = response.headers.getSetCookie()
  assert.equal(response.status, 200)
  assert.equal(body.user.email, fixtureEmail)
  assert.equal(body.user.role, 'REQUESTER')
  assert.equal(typeof body.user.passwordHash, 'undefined')
  assert.match(body.csrfToken, /^[A-Za-z0-9_-]{43}$/)

  const sessionSetCookie = cookies.find((cookie) => cookie.startsWith(`${process.env.NODE_ENV === 'production' ? '__Host-nexodesk_session' : 'nexodesk_session'}=`))
  const csrfSetCookie = cookies.find((cookie) => cookie.startsWith(`${process.env.NODE_ENV === 'production' ? '__Host-nexodesk_csrf' : 'nexodesk_csrf'}=`))
  assert.ok(sessionSetCookie && csrfSetCookie)
  assert.match(sessionSetCookie, /HttpOnly/i)
  assert.match(sessionSetCookie, /SameSite=Lax/i)
  assert.match(sessionSetCookie, /Max-Age=1209600/i)
  assert.match(csrfSetCookie, /HttpOnly/i)

  const session = sessionContext(response)
  const token = cookieValue(session.cookie.split('; ', 1)[0])
  const persisted = await prisma.session.findUnique({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
  })
  assert.ok(persisted)
  assert.notEqual(persisted.tokenHash, token)
  assert.equal(persisted.csrfTokenHash, createHash('sha256').update(session.csrfToken).digest('hex'))

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, { headers: session.headers() })
  const me = await meResponse.json()
  assert.equal(meResponse.status, 200)
  assert.equal(meResponse.headers.get('cache-control'), 'no-store')
  assert.equal(me.user.id, fixtureUser.id)
  assert.equal(me.csrfToken, session.csrfToken)
})

test('el rol se toma de la cuenta y no puede elevarse desde el cliente', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const spoofedLogin = await loginAs(fixtureEmail, fixturePassword, { role: 'ADMIN' })
  const loginBody = await spoofedLogin.json()
  assert.equal(spoofedLogin.status, 200)
  assert.equal(loginBody.user.role, 'REQUESTER')

  const spoofedTicket = await postTicket({
    title: 'Intento de elevación',
    description: 'El rol del cuerpo no debe cambiar permisos.',
    role: 'ADMIN',
  })
  assert.equal(spoofedTicket.status, 400)

  const meResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: sessionHeaders({ csrf: false }),
  })
  const me = await meResponse.json()
  assert.equal(me.user.role, 'REQUESTER')
})

test('credenciales incorrectas usan el mismo mensaje genérico', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const wrongPassword = await loginAs(fixtureEmail, `${fixturePassword}incorrecta`)
  const wrongBody = await wrongPassword.json()
  const unknownEmail = await loginAs('inexistente@example.test', fixturePassword)
  const unknownBody = await unknownEmail.json()

  assert.equal(wrongPassword.status, 401)
  assert.equal(unknownEmail.status, 401)
  assert.equal(wrongBody.error, 'Correo o contraseña incorrectos.')
  assert.deepEqual(unknownBody, wrongBody)
})

test('usuario inactivo no puede iniciar sesión y pierde acceso si se desactiva', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const passwordHash = await argon2.hash(fixturePassword, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 32,
  })
  const inactiveEmail = `inactive-${randomUUID()}@example.test`
  const inactiveUser = await prisma.user.create({
    data: { name: 'Usuario inactivo', email: inactiveEmail, passwordHash, isActive: false },
  })
  createdUserIds.push(inactiveUser.id)
  const blockedLogin = await loginAs(inactiveEmail, fixturePassword)
  assert.equal(blockedLogin.status, 401)
  assert.equal((await blockedLogin.json()).error, 'Correo o contraseña incorrectos.')

  const activeEmail = `deactivated-${randomUUID()}@example.test`
  const activeUser = await prisma.user.create({
    data: { name: 'Usuario que se desactiva', email: activeEmail, passwordHash },
  })
  createdUserIds.push(activeUser.id)
  const activeLogin = await loginAs(activeEmail, fixturePassword)
  assert.equal(activeLogin.status, 200)
  const contextForUser = sessionContext(activeLogin)
  await prisma.user.update({ where: { id: activeUser.id }, data: { isActive: false } })
  const blockedMe = await fetch(`${baseUrl}/api/auth/me`, { headers: contextForUser.headers() })
  assert.equal(blockedMe.status, 401)
})

test('endpoints de tickets exigen sesión y token CSRF para escritura', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const unauthenticatedList = await fetch(`${baseUrl}/api/tickets`)
  assert.equal(unauthenticatedList.status, 401)

  const unauthenticatedCreate = await postTicket({ title: 'Prueba', description: 'Prueba' }, { authenticated: false })
  assert.equal(unauthenticatedCreate.status, 401)

  const missingCsrf = await postTicket(
    { title: 'Prueba', description: 'Prueba' },
    { csrf: false },
  )
  assert.equal(missingCsrf.status, 403)

  const invalidCsrf = await fetch(`${baseUrl}/api/tickets`, {
    method: 'POST',
    headers: sessionHeaders({ 'content-type': 'application/json', 'x-csrf-token': 'A'.repeat(43) }),
    body: JSON.stringify({ title: 'Prueba', description: 'Prueba' }),
  })
  assert.equal(invalidCsrf.status, 403)

  const untrustedOrigin = await fetch(`${baseUrl}/api/tickets`, {
    method: 'POST',
    headers: sessionHeaders({
      'content-type': 'application/json',
      origin: 'https://no-confiable.example',
    }),
    body: JSON.stringify({ title: 'Prueba', description: 'Prueba' }),
  })
  assert.equal(untrustedOrigin.status, 403)
})

test('logout revoca la sesión y elimina las cookies', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const loginResponse = await loginAs(fixtureEmail, fixturePassword)
  assert.equal(loginResponse.status, 200)
  const contextForLogout = sessionContext(loginResponse)
  const response = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: contextForLogout.headers(),
  })
  assert.equal(response.status, 204)
  const clearedCookies = response.headers.getSetCookie()
  assert.equal(clearedCookies.length, 2)
  assert.ok(clearedCookies.every((cookie) => /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i.test(cookie)))

  const meAfterLogout = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { cookie: contextForLogout.cookie },
  })
  assert.equal(meAfterLogout.status, 401)
})

test('POST /api/tickets rechaza un título ausente', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const response = await postTicket({ description: 'Detalle del problema' })
  assert.equal(response.status, 400)
})

test('POST /api/tickets rechaza una prioridad inválida', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const response = await postTicket({
    title: 'Error de acceso',
    description: 'No permite iniciar sesión.',
    priority: 'CRITICAL',
  })
  assert.equal(response.status, 400)
})

test('POST /api/tickets no acepta campos administrados por el servidor', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const response = await postTicket({
    title: 'Error de acceso',
    description: 'No permite iniciar sesión.',
    code: 'NX-000001',
  })
  assert.equal(response.status, 400)
})

test('POST crea el ticket y PostgreSQL lo conserva; GET lo devuelve', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const response = await postTicket({
    title: ' No puedo conectarme a la VPN ',
    description: ' La conexión falla después de ingresar mis credenciales. ',
    priority: 'HIGH',
  })
  const ticket = await response.json()

  assert.equal(response.status, 201)
  assert.match(ticket.code, /^NX-\d{6,}$/)
  assert.equal(ticket.title, 'No puedo conectarme a la VPN')
  assert.equal(ticket.description, 'La conexión falla después de ingresar mis credenciales.')
  assert.equal(ticket.priority, 'HIGH')
  assert.equal(ticket.status, 'OPEN')
  createdTicketIds.push(ticket.id)

  const persisted = await prisma.ticket.findUnique({ where: { id: ticket.id } })
  assert.equal(persisted?.code, ticket.code)
  assert.equal(persisted?.createdById, fixtureUser.id)

  const listResponse = await getTickets()
  const tickets = await listResponse.json()
  assert.equal(listResponse.status, 200)
  assert.ok(Array.isArray(tickets))
  assert.ok(tickets.some((item) => item.id === ticket.id))

  const detailResponse = await getTicket(ticket.code)
  const detail = await detailResponse.json()
  assert.equal(detailResponse.status, 200)
  assert.equal(detail.id, ticket.id)
  assert.equal(detail.code, ticket.code)
  assert.equal(detail.status, ticket.status)
  assert.equal(detail.updatedAt, ticket.updatedAt)
  assert.deepEqual(
    detail.activities.map(({ fromStatus, toStatus }) => ({ fromStatus, toStatus })),
    [{ fromStatus: null, toStatus: 'OPEN' }],
  )

  const forbiddenTransition = await patchTicketStatus(ticket.code, 'RESOLVED')
  assert.equal(forbiddenTransition.status, 409)

  const requesterStatusChange = await patchTicketStatus(ticket.code, 'IN_PROGRESS', UserRole.REQUESTER)
  assert.equal(requesterStatusChange.status, 403)

  const invalidStatus = await patchTicketStatus(ticket.code, 'WAITING')
  assert.equal(invalidStatus.status, 400)

  for (const status of ['IN_PROGRESS', 'RESOLVED', 'IN_PROGRESS']) {
    const changeResponse = await patchTicketStatus(ticket.code, status)
    const changedTicket = await changeResponse.json()
    assert.equal(changeResponse.status, 200)
    assert.equal(changedTicket.status, status)
    assert.equal(changedTicket.activities.at(-1).toStatus, status)
    assert.equal(changedTicket.activities.at(-1).fromStatus, detail.activities.at(-1).toStatus)
    detail.activities = changedTicket.activities
  }

  const activityRows = await prisma.ticketActivity.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: 'asc' },
  })
  assert.equal(activityRows[0].actorUserId, fixtureUser.id)
  assert.ok(activityRows.slice(1).every(({ actorUserId }) => actorUserId === technicianUser.id))
  assert.deepEqual(
    activityRows.map(({ fromStatus, toStatus }) => ({ fromStatus, toStatus })),
    [
      { fromStatus: null, toStatus: 'OPEN' },
      { fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' },
      { fromStatus: 'IN_PROGRESS', toStatus: 'RESOLVED' },
      { fromStatus: 'RESOLVED', toStatus: 'IN_PROGRESS' },
    ],
  )
})

test('solicitante solo ve sus tickets; técnico usa la cola compartida sin crear ni administrar usuarios', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const ownResponse = await postTicket({
    title: 'Ticket propio para autorización',
    description: 'Debe ser visible al solicitante y al técnico.',
  })
  const ownTicket = await ownResponse.json()
  assert.equal(ownResponse.status, 201)
  createdTicketIds.push(ownTicket.id)

  const otherResponse = await postTicket({
    title: 'Ticket de otro usuario',
    description: 'El solicitante no debe verlo.',
  }, { role: UserRole.ADMIN })
  const otherTicket = await otherResponse.json()
  assert.equal(otherResponse.status, 201)
  createdTicketIds.push(otherTicket.id)

  const requesterListResponse = await getTickets(UserRole.REQUESTER)
  const requesterTickets = await requesterListResponse.json()
  assert.equal(requesterListResponse.status, 200)
  assert.ok(requesterTickets.some((ticket) => ticket.id === ownTicket.id))
  assert.ok(!requesterTickets.some((ticket) => ticket.id === otherTicket.id))
  assert.equal((await getTicket(otherTicket.code, UserRole.REQUESTER)).status, 404)

  const technicianListResponse = await getTickets(UserRole.TECHNICIAN)
  const technicianTickets = await technicianListResponse.json()
  assert.equal(technicianListResponse.status, 200)
  assert.ok(technicianTickets.some((ticket) => ticket.id === ownTicket.id))
  assert.ok(technicianTickets.some((ticket) => ticket.id === otherTicket.id))
  const technicianDetailResponse = await getTicket(ownTicket.code, UserRole.TECHNICIAN)
  const technicianDetail = await technicianDetailResponse.json()
  assert.equal(technicianDetailResponse.status, 200)
  assert.ok(Array.isArray(technicianDetail.activities))

  const technicianChange = await patchTicketStatus(ownTicket.code, 'IN_PROGRESS')
  assert.equal(technicianChange.status, 200)
  assert.equal((await prisma.ticket.findUnique({ where: { id: ownTicket.id } }))?.status, 'IN_PROGRESS')

  const technicianCreate = await postTicket({
    title: 'Técnico sin permiso de creación',
    description: 'La API debe rechazarlo.',
  }, { role: UserRole.TECHNICIAN })
  assert.equal(technicianCreate.status, 403)

  const userAdministration = await fetch(`${baseUrl}/api/users`, {
    method: 'POST',
    headers: sessionHeaders({ role: UserRole.TECHNICIAN, 'content-type': 'application/json' }),
    body: JSON.stringify({ name: 'No debe crearse', email: `blocked-${randomUUID()}@example.test` }),
  })
  assert.equal(userAdministration.status, 404)

  const adminListResponse = await getTickets(UserRole.ADMIN)
  const adminTickets = await adminListResponse.json()
  assert.ok(adminTickets.some((ticket) => ticket.id === ownTicket.id))
  assert.ok(adminTickets.some((ticket) => ticket.id === otherTicket.id))
})

test('administrador puede consultar y actualizar tickets históricos sin creador', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const historical = await prisma.ticket.create({
    data: {
      code: `NX-HIST-${randomUUID().slice(0, 8)}`,
      title: 'Ticket histórico sin creador',
      description: 'Conserva su creador nulo.',
      createdById: null,
    },
    select: { id: true, code: true, createdById: true },
  })
  createdTicketIds.push(historical.id)
  assert.equal(historical.createdById, null)

  const requesterResponse = await getTicket(historical.code, UserRole.REQUESTER)
  const technicianResponse = await getTicket(historical.code, UserRole.TECHNICIAN)
  assert.equal(requesterResponse.status, 404)
  assert.equal(technicianResponse.status, 404)

  const adminResponse = await getTicket(historical.code, UserRole.ADMIN)
  const adminTicket = await adminResponse.json()
  assert.equal(adminResponse.status, 200)
  assert.equal(adminTicket.id, historical.id)

  const adminListResponse = await getTickets(UserRole.ADMIN)
  const adminTickets = await adminListResponse.json()
  assert.ok(adminTickets.some((ticket) => ticket.id === historical.id))

  const technicianListResponse = await getTickets(UserRole.TECHNICIAN)
  const technicianTickets = await technicianListResponse.json()
  assert.ok(!technicianTickets.some((ticket) => ticket.id === historical.id))

  const adminChange = await patchTicketStatus(historical.code, 'IN_PROGRESS', UserRole.ADMIN)
  assert.equal(adminChange.status, 200)
  assert.equal((await prisma.ticket.findUnique({ where: { id: historical.id } }))?.status, 'IN_PROGRESS')
  const adminActivity = await prisma.ticketActivity.findFirst({
    where: { ticketId: historical.id, toStatus: 'IN_PROGRESS' },
  })
  assert.equal(adminActivity?.actorUserId, adminUser.id)
})

test('GET /api/tickets/:code devuelve 404 cuando el ticket no existe', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const missingCode = `NX-NOT-FOUND-${Date.now()}`
  const response = await getTicket(missingCode)
  const body = await response.json()

  assert.equal(response.status, 404)
  assert.equal(body.error, 'No se encontró el ticket solicitado.')

  const statusResponse = await patchTicketStatus(missingCode, 'IN_PROGRESS')
  assert.equal(statusResponse.status, 404)
})

test('solicitudes concurrentes reciben códigos diferentes', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const payload = (suffix) => ({
    title: `Solicitud concurrente ${suffix}`,
    description: 'Prueba de asignación de códigos.',
  })
  const responses = await Promise.all([
    postTicket(payload('A')),
    postTicket(payload('B')),
  ])
  const tickets = await Promise.all(responses.map((response) => response.json()))

  for (let index = 0; index < responses.length; index += 1) {
    assert.equal(responses[index].status, 201)
    createdTicketIds.push(tickets[index].id)
  }

  assert.notEqual(tickets[0].code, tickets[1].code)
})
