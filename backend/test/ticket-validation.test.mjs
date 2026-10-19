import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateTicketInput } from '../dist/routes/tickets.js'

test('valida y recorta el ticket; usa prioridad MEDIUM por omisión', () => {
  const result = validateTicketInput({
    title: '  Acceso VPN  ',
    description: '  No conecta.  ',
  })

  assert.equal(result.valid, true)
  if (result.valid) {
    assert.equal(result.value.title, 'Acceso VPN')
    assert.equal(result.value.description, 'No conecta.')
    assert.equal(result.value.priority, 'MEDIUM')
  }
})

test('rechaza título vacío y títulos superiores a 200 caracteres', () => {
  assert.equal(
    validateTicketInput({ title: '   ', description: 'Detalle' }).valid,
    false,
  )
  assert.equal(
    validateTicketInput({ title: 'x'.repeat(201), description: 'Detalle' }).valid,
    false,
  )
})

test('valida la prioridad real de Prisma y rechaza campos del servidor', () => {
  const valid = validateTicketInput({
    title: 'Acceso VPN',
    description: 'No conecta.',
    priority: 'HIGH',
  })
  const invalidPriority = validateTicketInput({
    title: 'Acceso VPN',
    description: 'No conecta.',
    priority: 'CRITICAL',
  })
  const clientCode = validateTicketInput({
    title: 'Acceso VPN',
    description: 'No conecta.',
    code: 'NX-000001',
  })

  assert.equal(valid.valid, true)
  assert.equal(invalidPriority.valid, false)
  assert.equal(clientCode.valid, false)
})
