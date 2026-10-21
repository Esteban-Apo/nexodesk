/**
 * Contrato para la futura integración OIDC. La identidad estable se resuelve
 * únicamente por emisor/proveedor y subject; el correo nunca vincula cuentas.
 */
export type FederatedIdentityKey = {
  provider: string
  providerSubject: string
}

export type FederatedIdentityProfile = FederatedIdentityKey & {
  email?: string
  emailVerified?: boolean
  displayName?: string
}

export interface FederatedIdentityRepository {
  findUserId(identity: FederatedIdentityKey): Promise<string | null>
  linkIdentity(userId: string, identity: FederatedIdentityKey): Promise<void>
}
