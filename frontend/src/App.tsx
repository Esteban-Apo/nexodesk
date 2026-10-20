import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import './App.css'
import { ApiError, API_BASE_URL, getConnectionErrorMessage, isRecord } from './services/api'
import { createTicket, getTickets } from './services/tickets'
import TicketDetail from './components/TicketDetail'
import {
  priorityLabels,
  statusLabels,
  ticketPriorities,
  type Ticket,
  type TicketPriority,
} from './types/ticket'

type HealthResponse = {
  status: 'ok'
  service: string
  timestamp: string
}

type HealthState =
  | { status: 'checking' }
  | { status: 'available'; service: string; checkedAt: Date }
  | { status: 'unavailable'; message: string }

const dateFormatter = new Intl.DateTimeFormat('es', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function readTicketCode(path: string): string | null {
  const match = path.match(/^\/tickets\/([^/]+)\/?$/)
  if (!match) return null

  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

function isHealthResponse(value: unknown): value is HealthResponse {
  return (
    isRecord(value) &&
    value.status === 'ok' &&
    typeof value.service === 'string' &&
    typeof value.timestamp === 'string' &&
    !Number.isNaN(Date.parse(value.timestamp))
  )
}

function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  const [health, setHealth] = useState<HealthState>({ status: 'checking' })
  const [healthCheckNumber, setHealthCheckNumber] = useState(0)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [ticketsError, setTicketsError] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [createdCode, setCreatedCode] = useState('')
  const mountedRef = useRef(true)
  const ticketsControllerRef = useRef<AbortController | null>(null)
  const createControllerRef = useRef<AbortController | null>(null)

  const navigateTo = useCallback((nextPath: string) => {
    const previousPath = window.location.pathname
    if (previousPath !== nextPath) window.history.pushState({}, '', nextPath)
    if (nextPath === '/' && previousPath !== '/') {
      setTicketsLoading(true)
      setTicketsError('')
    }
    setPath(nextPath)
  }, [])

  function handleInternalLink(event: MouseEvent<HTMLAnchorElement>, nextPath: string) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) return

    event.preventDefault()
    navigateTo(nextPath)
  }

  const refreshTickets = useCallback(async () => {
    ticketsControllerRef.current?.abort()
    const controller = new AbortController()
    ticketsControllerRef.current = controller
    setTicketsLoading(true)
    setTicketsError('')

    try {
      const latestTickets = await getTickets(controller.signal)
      if (!controller.signal.aborted && mountedRef.current) setTickets(latestTickets)
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current) {
        setTicketsError(getConnectionErrorMessage(error))
      }
    } finally {
      if (!controller.signal.aborted && mountedRef.current) setTicketsLoading(false)
      if (ticketsControllerRef.current === controller) ticketsControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    function handlePopState() {
      if (window.location.pathname === '/') {
        setTicketsLoading(true)
        setTicketsError('')
      }
      setPath(window.location.pathname)
    }

    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      mountedRef.current = false
      ticketsControllerRef.current?.abort()
      createControllerRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    if (path !== '/') return
    const controller = new AbortController()
    ticketsControllerRef.current?.abort()
    ticketsControllerRef.current = controller

    void getTickets(controller.signal)
      .then((latestTickets) => {
        if (!controller.signal.aborted && mountedRef.current) setTickets(latestTickets)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && mountedRef.current) {
          setTicketsError(getConnectionErrorMessage(error))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && mountedRef.current) setTicketsLoading(false)
        if (ticketsControllerRef.current === controller) ticketsControllerRef.current = null
      })

    return () => {
      controller.abort()
      if (ticketsControllerRef.current === controller) ticketsControllerRef.current = null
    }
  }, [path])

  useEffect(() => {
    const controller = new AbortController()

    async function checkHealth() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/health`, { signal: controller.signal })
        if (!response.ok) throw new ApiError(`La API respondió con HTTP ${response.status}.`, response.status)

        let payload: unknown
        try {
          payload = await response.json()
        } catch {
          throw new ApiError('La API devolvió una respuesta JSON inválida.')
        }
        if (!isHealthResponse(payload)) {
          throw new ApiError('La respuesta de salud de la API no tiene el formato esperado.')
        }

        if (!controller.signal.aborted && mountedRef.current) {
          setHealth({
            status: 'available',
            service: payload.service,
            checkedAt: new Date(payload.timestamp),
          })
        }
      } catch (error) {
        if (controller.signal.aborted || !mountedRef.current) return
        setHealth({ status: 'unavailable', message: getConnectionErrorMessage(error) })
      }
    }

    void checkHealth()
    return () => controller.abort()
  }, [healthCheckNumber])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (createControllerRef.current) return

    const trimmedTitle = title.trim()
    const trimmedDescription = description.trim()
    if (!trimmedTitle || !trimmedDescription) {
      setSubmitError('Completa el título y la descripción antes de enviar.')
      return
    }

    const controller = new AbortController()
    createControllerRef.current = controller
    setSubmitting(true)
    setSubmitError('')
    setCreatedCode('')

    try {
      const createdTicket = await createTicket(
        { title: trimmedTitle, description: trimmedDescription, priority },
        controller.signal,
      )
      if (!controller.signal.aborted && mountedRef.current) {
        setCreatedCode(createdTicket.code)
        setTitle('')
        setDescription('')
        setPriority('MEDIUM')
        await refreshTickets()
      }
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current) {
        setSubmitError(getConnectionErrorMessage(error))
      }
    } finally {
      if (createControllerRef.current === controller) createControllerRef.current = null
      if (!controller.signal.aborted && mountedRef.current) setSubmitting(false)
    }
  }

  const ticketCode = readTicketCode(path)

  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          aria-label="NexoDesk, inicio"
          onClick={(event) => handleInternalLink(event, '/')}
        >
          <span className="brand-mark" aria-hidden="true">N</span>
          <span>Nexo<span className="brand-light">Desk</span></span>
        </a>

        <div className={`api-indicator api-indicator--${health.status}`} aria-live="polite">
          <span className="api-dot" aria-hidden="true" />
          <span className="api-indicator-label">
            {health.status === 'checking' && 'Comprobando API'}
            {health.status === 'available' && 'API disponible'}
            {health.status === 'unavailable' && 'API no disponible'}
          </span>
          {health.status === 'available' && (
            <span className="api-service" title={health.service}>
              {health.service}
            </span>
          )}
          {health.status === 'available' && (
            <span className="api-checked">{dateFormatter.format(health.checkedAt)}</span>
          )}
          <button
            className="api-refresh"
            type="button"
            onClick={() => {
              setHealth({ status: 'checking' })
              setHealthCheckNumber((current) => current + 1)
            }}
            disabled={health.status === 'checking'}
            aria-label="Volver a comprobar la conexión con la API"
          >
            <span aria-hidden="true">↻</span>
          </button>
          {health.status === 'unavailable' && <span className="sr-only">{health.message}</span>}
          {health.status === 'available' && (
            <span className="sr-only">
              Última comprobación: {dateFormatter.format(health.checkedAt)}
            </span>
          )}
        </div>
      </header>

      {path === '/' ? <main id="inicio" className="page-content">
        <section className="page-intro" aria-labelledby="page-title">
          <p className="eyebrow"><span className="eyebrow-line" /> Centro de soporte</p>
          <h1 id="page-title">¿En qué podemos ayudarte?</h1>
          <p className="page-description">
            Crea una solicitud y nuestro equipo te ayudará a resolverla.
          </p>
        </section>

        <div className="workspace-grid">
          <section className="panel create-panel" aria-labelledby="create-title">
            <div className="panel-heading">
              <div className="heading-icon heading-icon--violet" aria-hidden="true">＋</div>
              <div>
                <p className="section-kicker">Nueva solicitud</p>
                <h2 id="create-title">Cuéntanos qué necesitas</h2>
              </div>
            </div>

            <form className="ticket-form" onSubmit={handleSubmit}>
              <div className="field-group">
                <label htmlFor="ticket-title">Título</label>
                <input
                  id="ticket-title"
                  name="title"
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ej. No puedo acceder a mi cuenta"
                  maxLength={200}
                  autoComplete="off"
                  required
                />
                <span className="field-hint">Resume el problema en una frase.</span>
              </div>

              <div className="field-group">
                <label htmlFor="ticket-description">Descripción</label>
                <textarea
                  id="ticket-description"
                  name="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Incluye los detalles que nos ayuden a entender lo que ocurre…"
                  rows={5}
                  required
                />
                <span className="field-hint">No incluyas contraseñas ni información sensible.</span>
              </div>

              <div className="field-group priority-field">
                <label htmlFor="ticket-priority">Prioridad</label>
                <select
                  id="ticket-priority"
                  name="priority"
                  value={priority}
                  onChange={(event) => {
                    const selectedPriority = ticketPriorities.find(
                      (item) => item === event.target.value,
                    )
                    if (selectedPriority) setPriority(selectedPriority)
                  }}
                >
                  {ticketPriorities.map((value) => (
                    <option key={value} value={value}>{priorityLabels[value]}</option>
                  ))}
                </select>
              </div>

              {submitError && <p className="form-message form-message--error" role="alert">{submitError}</p>}
              {createdCode && (
                <p className="form-message form-message--success" role="status">
                  Solicitud creada correctamente. Tu código es <strong>{createdCode}</strong>.
                </p>
              )}

              <button className="primary-button submit-button" type="submit" disabled={submitting}>
                {submitting ? 'Enviando solicitud…' : 'Enviar solicitud'}
                {!submitting && <span aria-hidden="true">→</span>}
              </button>
            </form>
          </section>

          <section className="panel tickets-panel" aria-labelledby="tickets-title">
            <div className="panel-heading tickets-heading">
              <div className="heading-icon heading-icon--blue" aria-hidden="true">▤</div>
              <div className="tickets-heading-copy">
                <p className="section-kicker">Seguimiento</p>
                <h2 id="tickets-title">Solicitudes recientes</h2>
              </div>
              <button
                className="refresh-button"
                type="button"
                onClick={() => void refreshTickets()}
                disabled={ticketsLoading}
                aria-label="Actualizar lista de solicitudes"
              >
                <span aria-hidden="true">↻</span>
                <span className="refresh-button-label">Actualizar</span>
              </button>
            </div>

            {ticketsLoading && tickets.length === 0 && (
              <div className="list-state" role="status">
                <span className="spinner" aria-hidden="true" />
                <p>Cargando solicitudes…</p>
              </div>
            )}

            {ticketsError && (
              <div className="list-state list-state--error" role="alert">
                <span className="state-symbol" aria-hidden="true">!</span>
                <h3>No pudimos cargar las solicitudes</h3>
                <p>{ticketsError}</p>
                <button className="secondary-button" type="button" onClick={() => void refreshTickets()}>
                  Intentar de nuevo
                </button>
              </div>
            )}

            {!ticketsLoading && !ticketsError && tickets.length === 0 && (
              <div className="list-state empty-state">
                <span className="empty-illustration" aria-hidden="true">✳</span>
                <h3>Aún no hay solicitudes</h3>
                <p>Cuando envíes una solicitud, aparecerá aquí para que puedas seguirla.</p>
              </div>
            )}

            {tickets.length > 0 && (
              <>
                {ticketsLoading && <p className="refreshing-note" role="status">Actualizando lista…</p>}
                <ul className="ticket-list" aria-label="Solicitudes registradas">
                  {tickets.map((ticket) => (
                    <li className="ticket-item" key={ticket.id}>
                      <a
                        className="ticket-link"
                        href={`/tickets/${encodeURIComponent(ticket.code)}`}
                        onClick={(event) =>
                          handleInternalLink(event, `/tickets/${encodeURIComponent(ticket.code)}`)
                        }
                      >
                        <div className="ticket-item-topline">
                          <span className="ticket-code">{ticket.code}</span>
                          <time dateTime={ticket.createdAt}>{dateFormatter.format(new Date(ticket.createdAt))}</time>
                        </div>
                        <h3>{ticket.title}</h3>
                        <p className="ticket-description">{ticket.description}</p>
                        <div className="ticket-meta">
                          <span className={`ticket-badge ticket-badge--priority-${ticket.priority.toLowerCase()}`}>
                            <span className="badge-dot" aria-hidden="true" />
                            {priorityLabels[ticket.priority]}
                          </span>
                          <span className={`ticket-badge ticket-badge--status-${ticket.status.toLowerCase()}`}>
                            {statusLabels[ticket.status]}
                          </span>
                        </div>
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        <footer className="page-footer">
          <span>© {new Date().getFullYear()} NexoDesk</span>
          <span>Tu equipo de soporte, más cerca.</span>
        </footer>
      </main> : ticketCode ? (
        <TicketDetail key={ticketCode} code={ticketCode} onBack={() => navigateTo('/')} />
      ) : (
        <main className="page-content detail-page">
          <section className="panel detail-state detail-state--message" role="status">
            <h1>Esta página no existe</h1>
            <p>La ruta solicitada no corresponde a una solicitud de NexoDesk.</p>
            <button className="secondary-button" type="button" onClick={() => navigateTo('/')}>
              Volver a solicitudes
            </button>
          </section>
        </main>
      )}
    </div>
  )
}

export default App
