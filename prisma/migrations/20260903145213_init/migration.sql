-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "metaKeys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSalt" (
    "siteId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "rotatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsSalt_pkey" PRIMARY KEY ("siteId","id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "visitKey" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device" TEXT,
    "os" TEXT,
    "country" TEXT NOT NULL DEFAULT 'XX',
    "region" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "lang" TEXT,
    "theme" TEXT,
    "from" TEXT,
    "ref" TEXT,
    "email" TEXT,
    "app" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "mergeCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT,
    "app" TEXT,
    "meta" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Visit_siteId_firstAt_idx" ON "Visit"("siteId", "firstAt");

-- CreateIndex
CREATE INDEX "Visit_siteId_email_idx" ON "Visit"("siteId", "email");

-- CreateIndex
CREATE INDEX "Visit_siteId_hash_lastAt_idx" ON "Visit"("siteId", "hash", "lastAt");

-- CreateIndex
CREATE INDEX "Visit_siteId_lastAt_idx" ON "Visit"("siteId", "lastAt");

-- CreateIndex
CREATE UNIQUE INDEX "Visit_siteId_visitKey_key" ON "Visit"("siteId", "visitKey");

-- CreateIndex
CREATE INDEX "Event_visitId_at_idx" ON "Event"("visitId", "at");

-- CreateIndex
CREATE INDEX "Event_page_action_at_idx" ON "Event"("page", "action", "at");

-- CreateIndex
CREATE INDEX "Event_at_idx" ON "Event"("at");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-added: Prisma cannot express a GIN index or an expression btree index
-- on a Json column, so these are appended manually after `prisma migrate
-- diff` generated the table/column DDL above. See prisma/schema.prisma's
-- comment on Visit.meta.

-- GIN index over the whole meta bag using jsonb_path_ops. jsonb_path_ops
-- (rather than the default jsonb_ops) only indexes the operators `@>` / `?`
-- style containment queries need, which is the only way the admin will ever
-- query meta ("visits where meta contains {restaurantId: X}") — it is
-- smaller and faster to build than jsonb_ops at the cost of not supporting
-- key-existence-only queries, which nothing here needs.
CREATE INDEX "Visit_meta_gin_idx" ON "Visit" USING GIN ("meta" jsonb_path_ops);

-- Expression btree index on the one hot custom key today (restaurantId).
-- jsonb_path_ops above is a fine "does this visit have meta matching X" index,
-- but scanning/filtering the admin visit list by a single scalar key is much
-- cheaper as a plain btree over the extracted text value.
CREATE INDEX "Visit_meta_restaurantId_idx" ON "Visit" ((("meta"->>'restaurantId')));
