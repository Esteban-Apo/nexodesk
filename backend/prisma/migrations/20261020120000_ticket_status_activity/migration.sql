CREATE TABLE "public"."TicketActivity" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "fromStatus" "public"."TicketStatus",
    "toStatus" "public"."TicketStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketActivity_ticketId_createdAt_idx"
    ON "public"."TicketActivity"("ticketId", "createdAt");

ALTER TABLE "public"."TicketActivity"
    ADD CONSTRAINT "TicketActivity_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "public"."Ticket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "public"."TicketActivity" ("id", "ticketId", "fromStatus", "toStatus", "createdAt")
SELECT gen_random_uuid(), "id", NULL, "status", "createdAt"
FROM "public"."Ticket";
