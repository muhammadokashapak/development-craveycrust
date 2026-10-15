-- CreateExtension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateTable
CREATE TABLE "faq_categories" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faq_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faqs" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "category_id" TEXT,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alternative_questions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "language" TEXT DEFAULT 'en',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faqs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "faq_categories_restaurant_id_is_active_idx" ON "faq_categories"("restaurant_id", "is_active");

-- CreateIndex
CREATE INDEX "faq_categories_restaurant_id_sort_order_idx" ON "faq_categories"("restaurant_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "faq_categories_restaurant_id_slug_key" ON "faq_categories"("restaurant_id", "slug");

-- CreateIndex
CREATE INDEX "faqs_restaurant_id_is_active_idx" ON "faqs"("restaurant_id", "is_active");

-- CreateIndex
CREATE INDEX "faqs_restaurant_id_category_id_idx" ON "faqs"("restaurant_id", "category_id");

-- CreateIndex
CREATE INDEX "faqs_restaurant_id_sort_order_idx" ON "faqs"("restaurant_id", "sort_order");

-- CreateTrigramIndexes
CREATE INDEX IF NOT EXISTS "faqs_question_trgm_idx" ON "faqs" USING gin ("question" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "faqs_answer_trgm_idx" ON "faqs" USING gin ("answer" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "faq_categories" ADD CONSTRAINT "faq_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faqs" ADD CONSTRAINT "faqs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "faq_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
