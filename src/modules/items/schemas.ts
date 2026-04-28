import { t, type Static } from "elysia";

import { supportedLanguages } from "../../db/schema";

const nutrientValue = t.Optional(t.Numeric({ minimum: 0 }));

export const nutritionPayloadSchema = t.Object({
  servingLabel: t.String({ minLength: 1 }),
  servingQuantity: t.Numeric({ minimum: 0 }),
  servingUnit: t.String({ minLength: 1 }),
  calories: nutrientValue,
  water: nutrientValue,
  alcohol: nutrientValue,
  caffeine: nutrientValue,
  cholesterol: nutrientValue,
  choline: nutrientValue,
  carbs: nutrientValue,
  fiber: nutrientValue,
  sugar: nutrientValue,
  addedSugar: nutrientValue,
  polyols: nutrientValue,
  fat: nutrientValue,
  monoUnsaturated: nutrientValue,
  polyUnsaturated: nutrientValue,
  omega3: nutrientValue,
  omega3Ala: nutrientValue,
  omega3Dha: nutrientValue,
  omega3Epa: nutrientValue,
  omega6: nutrientValue,
  saturated: nutrientValue,
  transFat: nutrientValue,
  protein: nutrientValue,
  cysteine: nutrientValue,
  histidine: nutrientValue,
  isoleucine: nutrientValue,
  leucine: nutrientValue,
  lysine: nutrientValue,
  methionine: nutrientValue,
  phenylalanine: nutrientValue,
  threonine: nutrientValue,
  tryptophan: nutrientValue,
  tyrosine: nutrientValue,
  valine: nutrientValue,
  a: nutrientValue,
  b1: nutrientValue,
  b2: nutrientValue,
  b3: nutrientValue,
  b5: nutrientValue,
  b6: nutrientValue,
  b12: nutrientValue,
  c: nutrientValue,
  d: nutrientValue,
  e: nutrientValue,
  k: nutrientValue,
  folate: nutrientValue,
  calcium: nutrientValue,
  copper: nutrientValue,
  iron: nutrientValue,
  magnesium: nutrientValue,
  manganese: nutrientValue,
  phosphorus: nutrientValue,
  potassium: nutrientValue,
  selenium: nutrientValue,
  sodium: nutrientValue,
  zinc: nutrientValue,
});

export const createItemSchema = t.Object({
  barcode: t.String({ minLength: 1, maxLength: 128 }),
  name: t.String({ minLength: 1 }),
  brand: t.Optional(t.Union([t.String(), t.Null()])),
  nutrition: nutritionPayloadSchema,
});

export const updateItemSchema = t.Object({
  barcode: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  name: t.Optional(t.String({ minLength: 1 })),
  brand: t.Optional(t.Union([t.String(), t.Null()])),
});

export const itemIdParamsSchema = t.Object({
  id: t.String({ format: "uuid" }),
});

export const barcodeParamsSchema = t.Object({
  barcode: t.String({ minLength: 1, maxLength: 128 }),
});

export const searchQuerySchema = t.Object({
  q: t.String({ minLength: 1 }),
  lang: t.Optional(t.Union(supportedLanguages.map((lang) => t.Literal(lang)))),
  limit: t.Optional(t.Numeric({ minimum: 1 })),
  minScore: t.Optional(t.Numeric({ minimum: 0 })),
});

export const scanItemSchema = t.Object({
  imageBase64: t.Optional(t.String({ minLength: 1 })),
  imageUrl: t.Optional(t.String({ minLength: 1 })),
  mimeType: t.Optional(t.String({ minLength: 1 })),
  lang: t.Optional(t.Union(supportedLanguages.map((lang) => t.Literal(lang)))),
});

export type NutritionPayload = Static<typeof nutritionPayloadSchema>;
export type CreateItemInput = Static<typeof createItemSchema>;
export type UpdateItemInput = Static<typeof updateItemSchema>;
export type SearchItemsQuery = Static<typeof searchQuerySchema>;
export type ScanItemInput = Static<typeof scanItemSchema>;
