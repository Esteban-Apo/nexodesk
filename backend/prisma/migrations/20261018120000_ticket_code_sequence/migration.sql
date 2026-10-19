-- Atomic, monotonic allocation for public ticket codes (safe under concurrent requests).
CREATE SEQUENCE "public"."ticket_code_seq"
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- Continue after any existing NX-numeric codes, without resetting ticket data.
SELECT setval(
    '"public"."ticket_code_seq"',
    GREATEST(
        COALESCE(
            (SELECT MAX(substring("code" FROM '^NX-([0-9]+)$')::BIGINT)
             FROM "public"."Ticket"),
            0
        ) + 1,
        1
    ),
    false
);
