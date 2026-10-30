-- eBay Listing previews (GraphQL Inventory Mapping API).
-- listingPreviewsCreationTask results (eBay-recommended category, aspects,
-- ePID for website products about to be listed) persisted for the admin Hub.
-- Tasks are pull-polled via GET /admin/ebay/listing-previews/tasks/:id.
CREATE TABLE "ebay_listing_preview_tasks" (
    "id" UUID NOT NULL,
    "ebay_task_id" VARCHAR(50) NOT NULL,
    "marketplace" VARCHAR(20) NOT NULL DEFAULT 'EBAY_US',
    "status" VARCHAR(30) NOT NULL DEFAULT 'running', -- running|completed|completed_with_error|failed
    "product_ids" JSONB NOT NULL DEFAULT '[]',
    "total" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "unprocessed" INTEGER NOT NULL DEFAULT 0,
    "unmapped" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_by" UUID,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ebay_listing_preview_tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ebay_listing_previews" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "task_id" VARCHAR(50) NOT NULL,
    "marketplace" VARCHAR(20) NOT NULL DEFAULT 'EBAY_US',
    "status" VARCHAR(20) NOT NULL DEFAULT 'suggested', -- suggested|applied
    "category_id" VARCHAR(20),
    "category_level" INTEGER,
    "category_name" VARCHAR(999),
    "epid" VARCHAR(50),
    "mapping_reference_id" VARCHAR(32),
    "suggested_title" VARCHAR(999),
    "aspects" JSONB,
    "outcome" VARCHAR(20), -- ok|unprocessed|unmapped|invalid
    "reason" TEXT,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ebay_listing_previews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ebay_listing_preview_tasks_ebay_task_id_key" ON "ebay_listing_preview_tasks"("ebay_task_id");
CREATE INDEX "ebay_listing_preview_tasks_status_created_at_idx" ON "ebay_listing_preview_tasks"("status", "created_at");
CREATE UNIQUE INDEX "ebay_listing_previews_task_id_product_id_key" ON "ebay_listing_previews"("task_id", "product_id");
CREATE INDEX "ebay_listing_previews_product_id_status_idx" ON "ebay_listing_previews"("product_id", "status");

ALTER TABLE "ebay_listing_previews" ADD CONSTRAINT "ebay_listing_previews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
