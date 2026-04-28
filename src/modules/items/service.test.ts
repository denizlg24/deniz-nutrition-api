import { afterEach, describe, expect, it } from "bun:test";

import type {
  NewItem,
  NewNutritionData,
  NutritionData,
  SupportedLanguage,
} from "../../db/schema";
import { ApiError } from "../../shared/errors";
import type {
  ItemSearchResult,
  ItemSummary,
  ItemSummaryInput,
} from "./repository";
import {
  ItemsService,
  OcrService,
  type ItemsRepositoryPort,
} from "./service";
import type {
  CreateItemInput,
  NutritionPayload,
  UpdateItemInput,
} from "./schemas";

const baseItem = {
  id: "3df21ba2-94ef-44fc-aed6-3593bb9ca001",
  barcode: "0123456789",
  name: "Greek Yogurt",
  brand: "Deniz Foods",
  servingLabel: "100 g",
  caloriesPerServing: 59,
  proteinPerServing: 10,
  carbsPerServing: 3.6,
  fatPerServing: 0.4,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} satisfies ItemSummary;

const nutritionPayload = {
  servingLabel: "100 g",
  servingQuantity: 100,
  servingUnit: "g",
  calories: 59,
  protein: 10,
  carbs: 3.6,
  fat: 0.4,
  sugar: 3.2,
} satisfies NutritionPayload;

class FakeItemsRepository implements ItemsRepositoryPort {
  existingByBarcode?: ItemSummary;
  existingById?: ItemSummary = baseItem;
  nutritionByItemId?: NutritionData;
  createdItem?: NewItem;
  createdNutrition?: Omit<NewNutritionData, "itemId">;
  updatedItem?: Partial<NewItem>;
  upsertedNutrition?: Omit<NewNutritionData, "itemId">;
  upsertedSummary?: ItemSummaryInput;
  searchArgs?: {
    query: string;
    language: SupportedLanguage;
    limit: number | undefined;
    minScore: number;
  };
  searchResults: ItemSearchResult[] = [{ ...baseItem, rank: 0.75, score: 1.1 }];

  async search(
    query: string,
    language: SupportedLanguage,
    limit: number | undefined,
    minScore: number,
  ): Promise<ItemSearchResult[]> {
    this.searchArgs = { query, language, limit, minScore };
    return this.searchResults;
  }

  async findById(_id: string) {
    return this.existingById;
  }

  async findByBarcode(_barcode: string) {
    return this.existingByBarcode;
  }

  async findNutritionByItemId(_itemId: string) {
    return this.nutritionByItemId;
  }

  async create(
    itemInput: NewItem,
    nutritionInput: Omit<NewNutritionData, "itemId">,
  ) {
    this.createdItem = itemInput;
    this.createdNutrition = nutritionInput;

    return {
      item: baseItem,
      nutrition: nutritionInput,
    };
  }

  async updateItem(_id: string, input: Partial<NewItem>) {
    this.updatedItem = input;
    return this.existingById;
  }

  async upsertNutrition(
    _itemId: string,
    input: Omit<NewNutritionData, "itemId">,
    summary: ItemSummaryInput,
  ) {
    this.upsertedNutrition = input;
    this.upsertedSummary = summary;

    return {
      item: baseItem,
      nutrition: input,
    };
  }
}

const createInput = {
  barcode: "0123456789",
  name: "Greek Yogurt",
  brand: "Deniz Foods",
  nutrition: nutritionPayload,
} satisfies CreateItemInput;

const originalFetch = globalThis.fetch;

const mockFetch = (response: Response): typeof fetch =>
  Object.assign(async () => response, {
    preconnect: originalFetch.preconnect,
  });

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ItemsService", () => {
  it("delegates search with default language and minimum score", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await expect(service.search("yogurt")).resolves.toEqual([
      { ...baseItem, rank: 0.75, score: 1.1 },
    ]);
    expect(repository.searchArgs).toEqual({
      query: "yogurt",
      language: "english",
      limit: undefined,
      minScore: 0.1,
    });
  });

  it("delegates search limit and minimum score overrides", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await service.search("yogurt", "english", 500, 0.25);

    expect(repository.searchArgs).toEqual({
      query: "yogurt",
      language: "english",
      limit: 500,
      minScore: 0.25,
    });
  });

  it("looks up items by barcode", async () => {
    const repository = new FakeItemsRepository();
    repository.existingByBarcode = baseItem;
    const service = new ItemsService(repository);

    await expect(service.getByBarcode("0123456789")).resolves.toEqual(baseItem);

    repository.existingByBarcode = undefined;
    await expect(service.getByBarcode("unknown")).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("creates an item with summary fields derived from nutrition", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await service.create(createInput);

    expect(repository.createdItem).toEqual({
      barcode: "0123456789",
      name: "Greek Yogurt",
      brand: "Deniz Foods",
      servingLabel: "100 g",
      caloriesPerServing: 59,
      proteinPerServing: 10,
      carbsPerServing: 3.6,
      fatPerServing: 0.4,
    });
    expect(repository.createdNutrition).toMatchObject({
      servingLabel: "100 g",
      servingQnty: 100,
      servingUnit: "g",
      calories: 59,
      protein: 10,
      carbs: 3.6,
      fat: 0.4,
      sugar: 3.2,
      water: 0,
      sodium: 0,
    });
  });

  it("blocks duplicate barcodes before creating", async () => {
    const repository = new FakeItemsRepository();
    repository.existingByBarcode = baseItem;
    const service = new ItemsService(repository);

    await expect(service.create(createInput)).rejects.toMatchObject({
      code: "BARCODE_ALREADY_EXISTS",
      statusCode: 409,
    });
    expect(repository.createdItem).toBeUndefined();
  });

  it("updates only mutable core item fields", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);
    const input = {
      name: "Updated Yogurt",
      brand: null,
    } satisfies UpdateItemInput;

    await service.update(baseItem.id, input);

    expect(repository.updatedItem).toEqual({
      name: "Updated Yogurt",
      brand: null,
    });
  });

  it("rejects empty item updates", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await expect(service.update(baseItem.id, {})).rejects.toMatchObject({
      code: "EMPTY_UPDATE",
      statusCode: 400,
    });
  });

  it("rejects updates for missing items", async () => {
    const repository = new FakeItemsRepository();
    repository.existingById = undefined;
    const service = new ItemsService(repository);

    await expect(service.update(baseItem.id, { name: "Missing" }))
      .rejects.toMatchObject({
        code: "ITEM_NOT_FOUND",
        statusCode: 404,
      });
  });

  it("refreshes item summary when nutrition is updated", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);
    const updatedNutrition = {
      ...nutritionPayload,
      servingLabel: "1 container",
      calories: 120,
      protein: 18,
      carbs: 8,
      fat: 2,
    } satisfies NutritionPayload;

    await service.updateNutrition(baseItem.id, updatedNutrition);

    expect(repository.upsertedSummary).toEqual({
      servingLabel: "1 container",
      caloriesPerServing: 120,
      proteinPerServing: 18,
      carbsPerServing: 8,
      fatPerServing: 2,
    });
    expect(repository.upsertedNutrition).toMatchObject({
      servingLabel: "1 container",
      calories: 120,
      protein: 18,
      carbs: 8,
      fat: 2,
    });
  });

  it("returns item and nutrition not-found errors", async () => {
    const repository = new FakeItemsRepository();
    repository.existingById = undefined;
    const service = new ItemsService(repository);

    await expect(service.getById(baseItem.id)).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
      statusCode: 404,
    });

    repository.existingById = baseItem;
    await expect(service.getNutrition(baseItem.id)).rejects.toMatchObject({
      code: "NUTRITION_NOT_FOUND",
      statusCode: 404,
    });
  });
});

describe("OcrService", () => {
  it("requires an image payload", async () => {
    const service = new OcrService("http://ocr.local");

    await expect(service.scan({})).rejects.toMatchObject({
      code: "SCAN_IMAGE_REQUIRED",
      statusCode: 400,
    });
  });

  it("requires an OCR provider URL", async () => {
    const service = new OcrService();

    await expect(service.scan({ imageUrl: "https://example.test/label.jpg" }))
      .rejects.toMatchObject({
        code: "OCR_NOT_CONFIGURED",
        statusCode: 501,
      });
  });

  it("parses a valid OCR provider payload", async () => {
    const service = new OcrService("http://ocr.local");
    globalThis.fetch = mockFetch(
      new Response(JSON.stringify(createInput), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(service.scan({ imageBase64: "Zm9v" })).resolves.toEqual(
      createInput,
    );
  });

  it("rejects invalid OCR provider payloads", async () => {
    const service = new OcrService("http://ocr.local");
    globalThis.fetch = mockFetch(
      new Response(JSON.stringify({ barcode: "missing-fields" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const error = await service
      .scan({ imageBase64: "Zm9v" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "OCR_PROVIDER_INVALID_RESPONSE",
      statusCode: 502,
    });
  });

  it("maps OCR provider failures to an API error", async () => {
    const service = new OcrService("http://ocr.local");
    globalThis.fetch = mockFetch(new Response("bad gateway", { status: 502 }));

    await expect(service.scan({ imageBase64: "Zm9v" })).rejects.toMatchObject({
      code: "OCR_PROVIDER_FAILED",
      statusCode: 502,
      details: { status: 502 },
    });
  });
});
