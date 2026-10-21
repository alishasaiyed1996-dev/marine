-- eBay → website catalog import (MT-13).
-- One row per admin-triggered import run. The discovered eBay item IDs live in
-- item_ids (JSONB) and cursor makes the run resumable across process restarts.

-- CreateTable
CREATE TABLE "ebay_import_jobs" (
    "id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "marketplace" VARCHAR(20) NOT NULL DEFAULT 'EBAY_US',
    "item_ids" JSONB NOT NULL DEFAULT '[]',
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "linked" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_by" UUID,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ebay_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ebay_import_jobs_status_created_at_idx" ON "ebay_import_jobs"("status", "created_at");
