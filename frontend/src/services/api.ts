export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(
  /\/$/,
  '',
)

export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readApiError(response: Response): Promise<ApiError> {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) {
      return new ApiError(payload.error, response.status)
    }
  } catch {
    // Fall back to the HTTP status when the server does not return JSON.
  }

  return new ApiError(`La API respondió con HTTP ${response.status}.`, response.status)
}

export function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'No se pudo conectar con la API. Comprueba que el backend esté en ejecución.'
}
