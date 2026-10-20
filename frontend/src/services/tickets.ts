import { ApiError, API_BASE_URL, isRecord, readApiError } from './api'
import {
  ticketPriorities,
  ticketStatuses,
  type CreateTicketInput,
  type Ticket,
  type TicketPriority,
  type TicketStatus,
} from '../types/ticket'

function isTicketPriority(value: unknown): value is TicketPriority {
  return typeof value === 'string' && ticketPriorities.some((priority) => priority === value)
}

function isTicketStatus(value: unknown): value is TicketStatus {
  return typeof value === 'string' && ticketStatuses.some((status) => status === value)
}

function parseTicket(value: unknown): Ticket {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.code !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    !isTicketStatus(value.status) ||
    !isTicketPriority(value.priority) ||
    typeof value.createdAt !== 'string' ||
    Number.isNaN(Date.parse(value.createdAt)) ||
    typeof value.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(value.updatedAt))
  ) {
    throw new ApiError('La API devolvió un ticket con un formato inesperado.')
  }

  return {
    id: value.id,
    code: value.code,
    title: value.title,
    description: value.description,
    status: value.status,
    priority: value.priority,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

export async function getTickets(signal?: AbortSignal): Promise<Ticket[]> {
  const response = await fetch(`${API_BASE_URL}/api/tickets`, { signal })
  if (!response.ok) throw await readApiError(response)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('La API devolvió una respuesta JSON inválida.')
  }

  if (!Array.isArray(payload)) {
    throw new ApiError('La API devolvió una lista de tickets con un formato inesperado.')
  }

  return payload.map(parseTicket)
}

export async function getTicketByCode(code: string, signal?: AbortSignal): Promise<Ticket> {
  const response = await fetch(`${API_BASE_URL}/api/tickets/${encodeURIComponent(code)}`, { signal })
  if (!response.ok) throw await readApiError(response)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('La API devolvió una respuesta JSON inválida.')
  }

  return parseTicket(payload)
}

export async function createTicket(
  input: CreateTicketInput,
  signal?: AbortSignal,
): Promise<Ticket> {
  const response = await fetch(`${API_BASE_URL}/api/tickets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  })
  if (!response.ok) throw await readApiError(response)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('La API devolvió una respuesta JSON inválida.')
  }

  return parseTicket(payload)
}
