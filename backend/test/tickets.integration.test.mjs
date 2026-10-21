import 'dotenv/config'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import { Client } from 'pg'
import { app } from '../dist/app.js'
import { prisma } from '../dist/lib/prisma.js'

let server
let baseUrl
let serverAvailable = false
let databaseAvailable = false
const createdTicketIds = []

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
})

after(async () => {
  try {
    if (databaseAvailable && createdTicketIds.length > 0) {
      await prisma.ticket.deleteMany({
        where: { id: { in: createdTicketIds } },
      })
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

async function postTicket(body) {
  return fetch(`${baseUrl}/api/tickets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function patchTicketStatus(code, status) {
  return fetch(`${baseUrl}/api/tickets/${encodeURIComponent(code)}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
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

test('POST /api/tickets rechaza un título ausente', async (context) => {
  if (!serverAvailable) {
    context.skip('El entorno no permite abrir un puerto local para pruebas HTTP.')
    return
  }

  const response = await postTicket({ description: 'Detalle del problema' })
  assert.equal(response.status, 400)
})

test('POST /api/tickets rechaza una prioridad inválida', async (context) => {
  if (!serverAvailable) {
    context.skip('El entorno no permite abrir un puerto local para pruebas HTTP.')
    return
  }

  const response = await postTicket({
    title: 'Error de acceso',
    description: 'No permite iniciar sesión.',
    priority: 'CRITICAL',
  })
  assert.equal(response.status, 400)
})

test('POST /api/tickets no acepta campos administrados por el servidor', async (context) => {
  if (!serverAvailable) {
    context.skip('El entorno no permite abrir un puerto local para pruebas HTTP.')
    return
  }

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

  const listResponse = await fetch(`${baseUrl}/api/tickets`)
  const tickets = await listResponse.json()
  assert.equal(listResponse.status, 200)
  assert.ok(Array.isArray(tickets))
  assert.ok(tickets.some((item) => item.id === ticket.id))

  const detailResponse = await fetch(`${baseUrl}/api/tickets/${encodeURIComponent(ticket.code)}`)
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

test('GET /api/tickets/:code devuelve 404 cuando el ticket no existe', async (context) => {
  if (!canRunDatabaseTest(context)) return

  const missingCode = `NX-NOT-FOUND-${Date.now()}`
  const response = await fetch(`${baseUrl}/api/tickets/${encodeURIComponent(missingCode)}`)
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
