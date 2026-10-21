CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'AGENT');

CREATE TABLE "public"."User" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "passwordHash" VARCHAR(255),
    "role" "public"."UserRole" NOT NULL DEFAULT 'AGENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "csrfTokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."AuthIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "providerSubject" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "public"."Session"("tokenHash");
CREATE INDEX "Session_userId_expiresAt_idx" ON "public"."Session"("userId", "expiresAt");
CREATE UNIQUE INDEX "AuthIdentity_provider_providerSubject_key"
    ON "public"."AuthIdentity"("provider", "providerSubject");
CREATE INDEX "AuthIdentity_userId_idx" ON "public"."AuthIdentity"("userId");

ALTER TABLE "public"."Ticket" ADD COLUMN "createdById" UUID;
CREATE INDEX "Ticket_createdById_idx" ON "public"."Ticket"("createdById");

ALTER TABLE "public"."TicketActivity" ADD COLUMN "actorUserId" UUID;
CREATE INDEX "TicketActivity_actorUserId_idx" ON "public"."TicketActivity"("actorUserId");

ALTER TABLE "public"."Session"
    ADD CONSTRAINT "Session_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."AuthIdentity"
    ADD CONSTRAINT "AuthIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "public"."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."Ticket"
    ADD CONSTRAINT "Ticket_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "public"."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."TicketActivity"
    ADD CONSTRAINT "TicketActivity_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "public"."User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
