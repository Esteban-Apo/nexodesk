import type { UserRole } from '../generated/prisma/client.js'

export type AuthContext = {
  userId: string
  name: string
  email: string
  role: UserRole
  sessionId: string
  csrfTokenHash: string
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

export {}
