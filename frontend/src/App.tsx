import { useEffect, useState } from 'react'
import './App.css'

type HealthResponse = {
  status: 'ok'
  service: string
  timestamp: string
}

type HealthState =
  | { status: 'checking' }
  | { status: 'available'; service: string; checkedAt: Date }
  | { status: 'unavailable'; message: string }

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '')

function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== 'object' || value === null) return false

  const response = value as Record<string, unknown>
  return (
    response.status === 'ok' &&
    typeof response.service === 'string' &&
    typeof response.timestamp === 'string' &&
    !Number.isNaN(Date.parse(response.timestamp))
  )
}

function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'checking' })
  const [checkNumber, setCheckNumber] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function checkHealth() {
      setHealth({ status: 'checking' })

      try {
        const response = await fetch(`${API_BASE_URL}/api/health`, {
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`La API respondió con HTTP ${response.status}.`)
        }

        let payload: unknown
        try {
          payload = await response.json()
        } catch {
          throw new Error('La API devolvió una respuesta JSON inválida.')
        }
        if (!isHealthResponse(payload)) {
          throw new Error('La respuesta de salud de la API no tiene el formato esperado.')
        }

        setHealth({
          status: 'available',
          service: payload.service,
          checkedAt: new Date(payload.timestamp),
        })
      } catch (error) {
        if (controller.signal.aborted) return

        setHealth({
          status: 'unavailable',
          message:
            error instanceof Error && error.message.startsWith('La API')
              ? error.message
              : 'No se pudo conectar con la API. Comprueba que el backend esté en ejecución.',
        })
      }
    }

    void checkHealth()
    return () => controller.abort()
  }, [checkNumber])

  return (
    <main className="health-page">
      <section className="health-card" aria-labelledby="page-title">
        <p className="eyebrow">NexoDesk</p>
        <h1 id="page-title">Estado del servicio</h1>
        <p className="intro">Comprueba la conexión entre la aplicación y la API.</p>

        <div
          className={`health-status health-status--${health.status}`}
          role="status"
          aria-live="polite"
        >
          <span className="status-indicator" aria-hidden="true" />
          <div>
            <h2>
              {health.status === 'checking' && 'Comprobando conexión…'}
              {health.status === 'available' && 'API disponible'}
              {health.status === 'unavailable' && 'No se pudo conectar con la API'}
            </h2>
            {health.status === 'available' && (
              <dl className="health-details">
                <div>
                  <dt>Servicio</dt>
                  <dd>{health.service}</dd>
                </div>
                <div>
                  <dt>Última comprobación</dt>
                  <dd>
                    <time dateTime={health.checkedAt.toISOString()}>
                      {health.checkedAt.toLocaleString()}
                    </time>
                  </dd>
                </div>
              </dl>
            )}
            {health.status === 'unavailable' && <p className="error-message">{health.message}</p>}
          </div>
        </div>

        <button
          className="check-button"
          type="button"
          onClick={() => setCheckNumber((current) => current + 1)}
          disabled={health.status === 'checking'}
        >
          Volver a comprobar
        </button>
      </section>
    </main>
  )
}

export default App
