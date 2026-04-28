import { Value } from "@sinclair/typebox/value";

import type {
  NewItem,
  NewNutritionData,
  NutritionData,
  SupportedLanguage,
} from "../../db/schema";
import { ApiError } from "../../shared/errors";
import type {
  CreateItemInput,
  NutritionPayload,
  ScanItemInput,
  UpdateItemInput,
} from "./schemas";
import { createItemSchema } from "./schemas";
import type { ItemSearchResult, ItemSummary, ItemSummaryInput } from "./repository";

const DEFAULT_MIN_SEARCH_SCORE = 0.1;

const nutrientKeys = [
  "calories",
  "water",
  "alcohol",
  "caffeine",
  "cholesterol",
  "choline",
  "carbs",
  "fiber",
  "sugar",
  "addedSugar",
  "polyols",
  "fat",
  "monoUnsaturated",
  "polyUnsaturated",
  "omega3",
  "omega3Ala",
  "omega3Dha",
  "omega3Epa",
  "omega6",
  "saturated",
  "transFat",
  "protein",
  "cysteine",
  "histidine",
  "isoleucine",
  "leucine",
  "lysine",
  "methionine",
  "phenylalanine",
  "threonine",
  "tryptophan",
  "tyrosine",
  "valine",
  "a",
  "b1",
  "b2",
  "b3",
  "b5",
  "b6",
  "b12",
  "c",
  "d",
  "e",
  "k",
  "folate",
  "calcium",
  "copper",
  "iron",
  "magnesium",
  "manganese",
  "phosphorus",
  "potassium",
  "selenium",
  "sodium",
  "zinc",
] as const satisfies readonly (keyof NutritionPayload)[];

type NutrientKey = (typeof nutrientKeys)[number];

const normalizeNutrition = (
  input: NutritionPayload,
): Omit<NewNutritionData, "itemId"> => {
  const nutrients = nutrientKeys.reduce(
    (current, key) => ({
      ...current,
      [key]: input[key] ?? 0,
    }),
    {} as Record<NutrientKey, number>,
  );

  return {
    servingLabel: input.servingLabel,
    servingQnty: input.servingQuantity,
    servingUnit: input.servingUnit,
    ...nutrients,
  };
};

const deriveItemNutritionSummary = (
  input: NutritionPayload,
): ItemSummaryInput => ({
  servingLabel: input.servingLabel,
  caloriesPerServing: input.calories ?? 0,
  proteinPerServing: input.protein ?? 0,
  carbsPerServing: input.carbs ?? 0,
  fatPerServing: input.fat ?? 0,
});

const normalizeItem = (input: CreateItemInput): NewItem => ({
  barcode: input.barcode,
  name: input.name,
  brand: input.brand ?? null,
  ...deriveItemNutritionSummary(input.nutrition),
});

const normalizeItemUpdate = (input: UpdateItemInput): Partial<NewItem> => {
  const update: Partial<NewItem> = {};

  if (input.barcode !== undefined) update.barcode = input.barcode;
  if (input.name !== undefined) update.name = input.name;
  if (input.brand !== undefined) update.brand = input.brand;

  return update;
};

const isEmptyObject = (value: Record<string, unknown>) =>
  Object.values(value).every((entry) => entry === undefined);

export class ItemsService {
  constructor(private readonly repository: ItemsRepositoryPort) {}

  async search(
    query: string,
    language: SupportedLanguage = "english",
    limit?: number,
    minScore = DEFAULT_MIN_SEARCH_SCORE,
  ) {
    return this.repository.search(query, language, limit, minScore);
  }

  async getById(id: string) {
    const item = await this.repository.findById(id);

    if (!item) {
      throw new ApiError(404, "ITEM_NOT_FOUND", "Item not found");
    }

    return item;
  }

  async getByBarcode(barcode: string) {
    const item = await this.repository.findByBarcode(barcode);

    if (!item) {
      throw new ApiError(404, "ITEM_NOT_FOUND", "Item not found");
    }

    return item;
  }

  async getNutrition(id: string) {
    await this.getById(id);
    const nutrition = await this.repository.findNutritionByItemId(id);

    if (!nutrition) {
      throw new ApiError(
        404,
        "NUTRITION_NOT_FOUND",
        "Nutrition data not found",
      );
    }

    return nutrition;
  }

  async create(input: CreateItemInput) {
    const existing = await this.repository.findByBarcode(input.barcode);

    if (existing) {
      throw new ApiError(
        409,
        "BARCODE_ALREADY_EXISTS",
        "An item with this barcode already exists",
      );
    }

    return this.repository.create(
      normalizeItem(input),
      normalizeNutrition(input.nutrition),
    );
  }

  async update(id: string, input: UpdateItemInput) {
    const normalized = normalizeItemUpdate(input);

    if (isEmptyObject(normalized)) {
      throw new ApiError(400, "EMPTY_UPDATE", "No item fields were provided");
    }

    const updated = await this.repository.updateItem(id, normalized);

    if (!updated) {
      throw new ApiError(404, "ITEM_NOT_FOUND", "Item not found");
    }

    return updated;
  }

  async updateNutrition(id: string, input: NutritionPayload) {
    await this.getById(id);
    return this.repository.upsertNutrition(
      id,
      normalizeNutrition(input),
      deriveItemNutritionSummary(input),
    );
  }
}

export interface ItemsRepositoryPort {
  search(
    query: string,
    language: SupportedLanguage,
    limit: number | undefined,
    minScore: number,
  ): Promise<ItemSearchResult[]>;
  findById(id: string): Promise<ItemSummary | undefined>;
  findByBarcode(barcode: string): Promise<ItemSummary | undefined>;
  findNutritionByItemId(
    itemId: string,
  ): Promise<NutritionData | undefined>;
  create(
    itemInput: NewItem,
    nutritionInput: Omit<NewNutritionData, "itemId">,
  ): Promise<unknown>;
  updateItem(
    id: string,
    input: Partial<NewItem>,
  ): Promise<ItemSummary | undefined>;
  upsertNutrition(
    itemId: string,
    input: Omit<NewNutritionData, "itemId">,
    summary: ItemSummaryInput,
  ): Promise<unknown>;
}

export class OcrService {
  constructor(private readonly serviceUrl?: string) {}

  async scan(input: ScanItemInput): Promise<CreateItemInput> {
    if (!input.imageBase64 && !input.imageUrl) {
      throw new ApiError(
        400,
        "SCAN_IMAGE_REQUIRED",
        "Provide imageBase64 or imageUrl",
      );
    }

    if (!this.serviceUrl) {
      throw new ApiError(
        501,
        "OCR_NOT_CONFIGURED",
        "OCR provider is not configured",
      );
    }

    const response = await fetch(this.serviceUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new ApiError(
        502,
        "OCR_PROVIDER_FAILED",
        "OCR provider request failed",
        { status: response.status },
      );
    }

    try {
      return Value.Parse(createItemSchema, await response.json());
    } catch (error) {
      throw new ApiError(
        502,
        "OCR_PROVIDER_INVALID_RESPONSE",
        "OCR provider returned an invalid item payload",
        error instanceof Error ? error.message : undefined,
      );
    }
  }
}
