ALTER TABLE "products"
  ADD COLUMN "content_updated_at" TIMESTAMP(3);

UPDATE "products"
SET "content_updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP);

ALTER TABLE "products"
  ALTER COLUMN "content_updated_at" SET NOT NULL,
  ALTER COLUMN "content_updated_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "product_slug_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "product_id" UUID NOT NULL,
  "slug" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_slug_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_slug_history_slug_key" ON "product_slug_history"("slug");
CREATE INDEX "product_slug_history_product_id_idx" ON "product_slug_history"("product_id");
ALTER TABLE "product_slug_history" ADD CONSTRAINT "product_slug_history_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
