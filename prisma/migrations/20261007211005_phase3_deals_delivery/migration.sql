-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "PromotionTargetType" AS ENUM ('ALL', 'CATEGORY', 'MENU_ITEM', 'VARIANT', 'DEAL');

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "deal_price" DECIMAL(10,2) NOT NULL,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_items" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "menu_item_id" TEXT NOT NULL,
    "menu_variant_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "discount_type" "DiscountType" NOT NULL DEFAULT 'PERCENTAGE',
    "discount_value" DECIMAL(10,2) NOT NULL,
    "minimum_order" DECIMAL(10,2),
    "maximum_discount" DECIMAL(10,2),
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_targets" (
    "id" TEXT NOT NULL,
    "promotion_id" TEXT NOT NULL,
    "target_type" "PromotionTargetType" NOT NULL DEFAULT 'ALL',
    "target_id" TEXT,

    CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_areas" (
    "id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "delivery_fee" DECIMAL(10,2) NOT NULL,
    "minimum_order" DECIMAL(10,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radius_km" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_areas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deals_restaurant_id_is_active_idx" ON "deals"("restaurant_id", "is_active");

-- CreateIndex
CREATE INDEX "deals_restaurant_id_sort_order_idx" ON "deals"("restaurant_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "deals_restaurant_id_slug_key" ON "deals"("restaurant_id", "slug");

-- CreateIndex
CREATE INDEX "deal_items_deal_id_idx" ON "deal_items"("deal_id");

-- CreateIndex
CREATE INDEX "deal_items_menu_item_id_idx" ON "deal_items"("menu_item_id");

-- CreateIndex
CREATE INDEX "promotions_restaurant_id_is_active_idx" ON "promotions"("restaurant_id", "is_active");

-- CreateIndex
CREATE INDEX "promotions_code_idx" ON "promotions"("code");

-- CreateIndex
CREATE INDEX "promotion_targets_promotion_id_idx" ON "promotion_targets"("promotion_id");

-- CreateIndex
CREATE INDEX "delivery_areas_restaurant_id_is_active_idx" ON "delivery_areas"("restaurant_id", "is_active");

-- CreateIndex
CREATE INDEX "delivery_areas_restaurant_id_sort_order_idx" ON "delivery_areas"("restaurant_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_areas_restaurant_id_slug_key" ON "delivery_areas"("restaurant_id", "slug");

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_items" ADD CONSTRAINT "deal_items_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_items" ADD CONSTRAINT "deal_items_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_items" ADD CONSTRAINT "deal_items_menu_variant_id_fkey" FOREIGN KEY ("menu_variant_id") REFERENCES "menu_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_areas" ADD CONSTRAINT "delivery_areas_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
