-- Preserve existing AGENT accounts by carrying their support role forward as TECHNICIAN.
ALTER TYPE "public"."UserRole" RENAME VALUE 'AGENT' TO 'TECHNICIAN';
ALTER TYPE "public"."UserRole" ADD VALUE 'REQUESTER' BEFORE 'TECHNICIAN';
