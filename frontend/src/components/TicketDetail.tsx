import { useEffect, useState } from 'react'
import { ApiError, getConnectionErrorMessage } from '../services/api'
import { changeTicketStatus, getTicketByCode } from '../services/tickets'
import { priorityLabels, statusLabels, type Ticket, type TicketStatus } from '../types/ticket'

type DetailState =
  | { status: 'loading' }
  | { status: 'loaded'; ticket: Ticket }
  | { status: 'not-found' }
  | { status: 'error'; message: string }

type TicketDetailProps = {
  code: string
  onBack: () => void
}

const dateFormatter = new Intl.DateTimeFormat('es', {
  dateStyle: 'medium',
  timeStyle: 'short',
})
const nextStatuses: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['OPEN', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS'],
  CLOSED: [],
}

function transitionLabel(status: TicketStatus): string {
  return status === 'IN_PROGRESS' ? 'En progreso' : statusLabels[status].toLowerCase()
}

function TicketDetail({ code, onBack }: TicketDetailProps) {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [retryNumber, setRetryNumber] = useState(0)
  const [savingStatus, setSavingStatus] = useState(false)
  const [statusError, setStatusError] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    void getTicketByCode(code, controller.signal)
      .then((ticket) => {
        if (!controller.signal.aborted) setState({ status: 'loaded', ticket })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof ApiError && error.status === 404) {
          setState({ status: 'not-found' })
          return
        }
        setState({ status: 'error', message: getConnectionErrorMessage(error) })
      })

    return () => controller.abort()
  }, [code, retryNumber])

  async function updateStatus(status: TicketStatus) {
    if (state.status !== 'loaded' || savingStatus) return
    setSavingStatus(true)
    setStatusError('')
    try {
      const ticket = await changeTicketStatus(code, status)
      setState({ status: 'loaded', ticket })
    } catch (error: unknown) {
      setStatusError(getConnectionErrorMessage(error))
    } finally {
      setSavingStatus(false)
    }
  }

  return (
    <main className="page-content detail-page">
      <button className="back-button" type="button" onClick={onBack}>
        <span aria-hidden="true">←</span> Volver a solicitudes
      </button>

      {state.status === 'loading' && (
        <section className="panel detail-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>Cargando ticket {code}…</p>
        </section>
      )}

      {state.status === 'not-found' && (
        <section className="panel detail-state detail-state--message" role="status">
          <span className="state-symbol" aria-hidden="true">?</span>
          <h1>No encontramos este ticket</h1>
          <p>El código <strong>{code}</strong> no corresponde a una solicitud registrada.</p>
          <button className="secondary-button" type="button" onClick={onBack}>
            Volver a solicitudes
          </button>
        </section>
      )}

      {state.status === 'error' && (
        <section className="panel detail-state detail-state--message" role="alert">
          <span className="state-symbol" aria-hidden="true">!</span>
          <h1>No se pudo cargar el ticket</h1>
          <p>{state.message}</p>
          <div className="detail-state-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setState({ status: 'loading' })
                setRetryNumber((current) => current + 1)
              }}
            >
              Intentar de nuevo
            </button>
            <button className="text-button" type="button" onClick={onBack}>
              Volver a solicitudes
            </button>
          </div>
        </section>
      )}

      {state.status === 'loaded' && (
        <>
          <section className="panel detail-summary" aria-labelledby="ticket-title">
            <div className="detail-summary-topline">
              <span className="detail-code">{state.ticket.code}</span>
              <div className="ticket-meta" aria-label="Estado y prioridad">
                <span className={`ticket-badge ticket-badge--status-${state.ticket.status.toLowerCase()}`}>
                  {statusLabels[state.ticket.status]}
                </span>
                <span className={`ticket-badge ticket-badge--priority-${state.ticket.priority.toLowerCase()}`}>
                  <span className="badge-dot" aria-hidden="true" />
                  {priorityLabels[state.ticket.priority]}
                </span>
              </div>
            </div>
            <h1 id="ticket-title">{state.ticket.title}</h1>
            <p className="detail-created">
              Creado el <time dateTime={state.ticket.createdAt}>
                {dateFormatter.format(new Date(state.ticket.createdAt))}
              </time>
            </p>
            <div className="status-actions" aria-label="Cambiar estado del ticket">
              <span className="status-actions-label">Cambiar estado</span>
              {nextStatuses[state.ticket.status].length > 0 ? (
                nextStatuses[state.ticket.status].map((status) => (
                  <button
                    className="secondary-button status-action"
                    key={status}
                    type="button"
                    disabled={savingStatus}
                    onClick={() => void updateStatus(status)}
                  >
                    {savingStatus ? 'Actualizando…' : `Pasar a ${transitionLabel(status)}`}
                  </button>
                ))
              ) : (
                <span className="status-actions-note">Este ticket no admite más cambios de estado.</span>
              )}
            </div>
            {statusError && <p className="status-error" role="alert">{statusError}</p>}
          </section>

          <div className="detail-grid">
            <section className="panel description-panel" aria-labelledby="description-title">
              <div className="detail-section-heading">
                <span className="detail-section-icon" aria-hidden="true">✳</span>
                <h2 id="description-title">Descripción de la solicitud</h2>
              </div>
              <p className="full-description">{state.ticket.description}</p>
            </section>

            <aside className="panel information-panel" aria-labelledby="information-title">
              <div className="detail-section-heading">
                <span className="detail-section-icon detail-section-icon--blue" aria-hidden="true">⌑</span>
                <h2 id="information-title">Información adicional</h2>
              </div>
              <dl className="ticket-information">
                <div>
                  <dt>Identificador</dt>
                  <dd className="ticket-id">{state.ticket.id}</dd>
                </div>
                <div>
                  <dt>Fecha de creación</dt>
                  <dd><time dateTime={state.ticket.createdAt}>
                    {dateFormatter.format(new Date(state.ticket.createdAt))}
                  </time></dd>
                </div>
                <div>
                  <dt>Última actualización</dt>
                  <dd><time dateTime={state.ticket.updatedAt}>
                    {dateFormatter.format(new Date(state.ticket.updatedAt))}
                  </time></dd>
                </div>
              </dl>
            </aside>
          </div>

          <section className="panel activity-panel" aria-labelledby="activity-title">
            <div className="detail-section-heading">
              <span className="detail-section-icon detail-section-icon--blue" aria-hidden="true">↻</span>
              <h2 id="activity-title">Historial de actividad</h2>
            </div>
            {(state.ticket.activities ?? []).length > 0 ? (
              <ol className="activity-list">
                {(state.ticket.activities ?? []).map((activity) => (
                  <li className="activity-item" key={activity.id}>
                    <span className="activity-marker" aria-hidden="true" />
                    <div>
                      <p>
                        {activity.fromStatus
                          ? <>Estado cambiado de <strong>{statusLabels[activity.fromStatus]}</strong> a <strong>{statusLabels[activity.toStatus]}</strong></>
                          : <>Solicitud creada con estado <strong>{statusLabels[activity.toStatus]}</strong></>}
                      </p>
                      <time dateTime={activity.createdAt}>
                        {dateFormatter.format(new Date(activity.createdAt))}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="activity-empty">Todavía no hay actividad registrada para esta solicitud.</p>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default TicketDetail
