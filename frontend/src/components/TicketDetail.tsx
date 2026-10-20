import { useEffect, useState } from 'react'
import { ApiError, getConnectionErrorMessage } from '../services/api'
import { getTicketByCode } from '../services/tickets'
import { priorityLabels, statusLabels, type Ticket } from '../types/ticket'

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

function TicketDetail({ code, onBack }: TicketDetailProps) {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [retryNumber, setRetryNumber] = useState(0)

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
        </>
      )}
    </main>
  )
}

export default TicketDetail
