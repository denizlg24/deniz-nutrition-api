import {
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";

export const supportedLanguages = [
  "english",
  "portuguese",
  "spanish",
  "french",
] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

const nutrient = (name: string) =>
  numeric(name, { precision: 12, scale: 3, mode: "number" })
    .notNull()
    .default(0);

const requiredAmount = (name: string) =>
  numeric(name, { precision: 12, scale: 3, mode: "number" }).notNull();

export const items = pgTable(
  "items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barcode: text("barcode").notNull(),
    name: text("name").notNull(),
    brand: text("brand"),
    servingLabel: text("serving_label").notNull(),
    caloriesPerServing: requiredAmount("calories_per_serving").default(0),
    proteinPerServing: requiredAmount("protein_per_serving").default(0),
    carbsPerServing: requiredAmount("carbs_per_serving").default(0),
    fatPerServing: requiredAmount("fat_per_serving").default(0),
    searchVectorEnglish: tsvector("search_vector_english")
      .notNull()
      .default(sql`''::tsvector`),
    searchVectorPortuguese: tsvector("search_vector_portuguese")
      .notNull()
      .default(sql`''::tsvector`),
    searchVectorSpanish: tsvector("search_vector_spanish")
      .notNull()
      .default(sql`''::tsvector`),
    searchVectorFrench: tsvector("search_vector_french")
      .notNull()
      .default(sql`''::tsvector`),
    brandSearchVectorEnglish: tsvector("brand_search_vector_english")
      .notNull()
      .default(sql`''::tsvector`),
    brandSearchVectorPortuguese: tsvector("brand_search_vector_portuguese")
      .notNull()
      .default(sql`''::tsvector`),
    brandSearchVectorSpanish: tsvector("brand_search_vector_spanish")
      .notNull()
      .default(sql`''::tsvector`),
    brandSearchVectorFrench: tsvector("brand_search_vector_french")
      .notNull()
      .default(sql`''::tsvector`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("items_barcode_idx").on(table.barcode),
    index("items_search_vector_english_idx").using(
      "gin",
      table.searchVectorEnglish,
    ),
    index("items_search_vector_portuguese_idx").using(
      "gin",
      table.searchVectorPortuguese,
    ),
    index("items_search_vector_spanish_idx").using(
      "gin",
      table.searchVectorSpanish,
    ),
    index("items_search_vector_french_idx").using(
      "gin",
      table.searchVectorFrench,
    ),
    index("items_brand_search_vector_english_idx").using(
      "gin",
      table.brandSearchVectorEnglish,
    ),
    index("items_brand_search_vector_portuguese_idx").using(
      "gin",
      table.brandSearchVectorPortuguese,
    ),
    index("items_brand_search_vector_spanish_idx").using(
      "gin",
      table.brandSearchVectorSpanish,
    ),
    index("items_brand_search_vector_french_idx").using(
      "gin",
      table.brandSearchVectorFrench,
    ),
  ],
);

export const nutritionData = pgTable(
  "nutrition_data",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    servingLabel: text("serving_label").notNull(),
    servingQnty: requiredAmount("serving_qnty"),
    servingUnit: text("serving_unit").notNull(),
    calories: nutrient("calories"),
    water: nutrient("water"),
    alcohol: nutrient("alcohol"),
    caffeine: nutrient("caffeine"),
    cholesterol: nutrient("cholesterol"),
    choline: nutrient("choline"),
    carbs: nutrient("carbs"),
    fiber: nutrient("fiber"),
    sugar: nutrient("sugar"),
    addedSugar: nutrient("added_sugar"),
    polyols: nutrient("polyols"),
    fat: nutrient("fat"),
    monoUnsaturated: nutrient("mono_unsaturated"),
    polyUnsaturated: nutrient("poly_unsaturated"),
    omega3: nutrient("omega_3"),
    omega3Ala: nutrient("omega_3_ala"),
    omega3Dha: nutrient("omega_3_dha"),
    omega3Epa: nutrient("omega_3_epa"),
    omega6: nutrient("omega_6"),
    saturated: nutrient("saturated"),
    transFat: nutrient("trans_fat"),
    protein: nutrient("protein"),
    cysteine: nutrient("cysteine"),
    histidine: nutrient("histidine"),
    isoleucine: nutrient("isoleucine"),
    leucine: nutrient("leucine"),
    lysine: nutrient("lysine"),
    methionine: nutrient("methionine"),
    phenylalanine: nutrient("phenylalanine"),
    threonine: nutrient("threonine"),
    tryptophan: nutrient("tryptophan"),
    tyrosine: nutrient("tyrosine"),
    valine: nutrient("valine"),
    a: nutrient("a"),
    b1: nutrient("b1"),
    b2: nutrient("b2"),
    b3: nutrient("b3"),
    b5: nutrient("b5"),
    b6: nutrient("b6"),
    b12: nutrient("b12"),
    c: nutrient("c"),
    d: nutrient("d"),
    e: nutrient("e"),
    k: nutrient("k"),
    folate: nutrient("folate"),
    calcium: nutrient("calcium"),
    copper: nutrient("copper"),
    iron: nutrient("iron"),
    magnesium: nutrient("magnesium"),
    manganese: nutrient("manganese"),
    phosphorus: nutrient("phosphorus"),
    potassium: nutrient("potassium"),
    selenium: nutrient("selenium"),
    sodium: nutrient("sodium"),
    zinc: nutrient("zinc"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId], name: "nutrition_data_item_id_pk" }),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_keys_key_prefix_idx").on(table.keyPrefix),
    uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_active_key_hash_idx")
      .on(table.keyHash)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type NutritionData = typeof nutritionData.$inferSelect;
export type NewNutritionData = typeof nutritionData.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
