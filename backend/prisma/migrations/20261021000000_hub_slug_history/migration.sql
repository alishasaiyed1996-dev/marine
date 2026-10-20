-- Previous URLs for brand, category, and industry hubs. Renaming an entity
-- keeps its existing slug; only an explicit slug change writes a row here, and
-- the public route turns the old slug into a 301. Industries have no standalone
-- storefront page yet, so their history is stored for the future directory.

CREATE TABLE "category_slug_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "category_id" UUID NOT NULL,
  "slug" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "category_slug_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "category_slug_history_slug_key" ON "category_slug_history"("slug");
CREATE INDEX "category_slug_history_category_id_idx" ON "category_slug_history"("category_id");
ALTER TABLE "category_slug_history" ADD CONSTRAINT "category_slug_history_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "brand_slug_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "brand_id" UUID NOT NULL,
  "slug" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "brand_slug_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "brand_slug_history_slug_key" ON "brand_slug_history"("slug");
CREATE INDEX "brand_slug_history_brand_id_idx" ON "brand_slug_history"("brand_id");
ALTER TABLE "brand_slug_history" ADD CONSTRAINT "brand_slug_history_brand_id_fkey"
  FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "industry_slug_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "industry_id" UUID NOT NULL,
  "slug" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "industry_slug_history_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "industry_slug_history_slug_key" ON "industry_slug_history"("slug");
CREATE INDEX "industry_slug_history_industry_id_idx" ON "industry_slug_history"("industry_id");
ALTER TABLE "industry_slug_history" ADD CONSTRAINT "industry_slug_history_industry_id_fkey"
  FOREIGN KEY ("industry_id") REFERENCES "industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
