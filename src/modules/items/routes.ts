import { Elysia } from "elysia";

import { db } from "../../db/client";
import { env } from "../../config/env";
import { meilisearch } from "../../infra/meilisearch";
import { getRequestContext } from "../../shared/request-context";
import { fail, ok } from "../../shared/http";
import { isApiError } from "../../shared/errors";
import { ItemsRepository } from "./repository";
import { ItemsService, OcrService } from "./service";
import {
  barcodeParamsSchema,
  createItemSchema,
  itemIdParamsSchema,
  nutritionPayloadSchema,
  scanItemSchema,
  searchQuerySchema,
  updateItemSchema,
} from "./schemas";

const getRequestId = (request: Request) =>
  getRequestContext(request)?.requestId ?? "unknown";

const toApiErrorResponse = (error: unknown, request: Request, set: {
  status?: number | string;
}) => {
  if (!isApiError(error)) {
    throw error;
  }

  set.status = error.statusCode;

  return fail(
    {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    getRequestId(request),
  );
};

const repository = new ItemsRepository(db, meilisearch);
const service = new ItemsService(repository);
const ocrService = new OcrService(env.ocrServiceUrl);

export const itemsRoutes = new Elysia({ prefix: "/items" })
  .get(
    "/search",
    async ({ query, request }) =>
      ok(
        await service.search(
          {
            query: query.q,
            brand: query.brand,
          },
          query.lang ?? "english",
          query.limit,
          query.minScore,
        ),
        getRequestId(request),
      ),
    {
      query: searchQuerySchema,
      detail: {
        summary: "Search items",
        description:
          "Full-text search by item name, brand, or both. The requested language is prioritized in ranking.",
        tags: ["Items"],
      },
    },
  )
  .get(
    "/barcode/:barcode",
    async ({ params, request, set }) => {
      try {
        return ok(
          await service.getByBarcode(params.barcode),
          getRequestId(request),
        );
      } catch (error) {
        return toApiErrorResponse(error, request, set);
      }
    },
    {
      params: barcodeParamsSchema,
      detail: {
        summary: "Get item by barcode",
        tags: ["Items"],
      },
    },
  )
  .get(
    "/:id",
    async ({ params, request }) =>
      ok(await service.getById(params.id), getRequestId(request)),
    {
      params: itemIdParamsSchema,
      detail: {
        summary: "Get item summary",
        tags: ["Items"],
      },
    },
  )
  .get(
    "/:id/nutrition",
    async ({ params, request }) =>
      ok(await service.getNutrition(params.id), getRequestId(request)),
    {
      params: itemIdParamsSchema,
      detail: {
        summary: "Get item nutrition",
        tags: ["Items"],
      },
    },
  )
  .post(
    "/",
    async ({ body, request, set }) => {
      set.status = 201;
      return ok(await service.create(body), getRequestId(request));
    },
    {
      body: createItemSchema,
      detail: {
        summary: "Create item",
        description:
          "Creates an item and its first nutrition payload. Quick summary fields are derived from nutrition.",
        tags: ["Items"],
      },
    },
  )
  .put(
    "/:id",
    async ({ params, body, request }) =>
      ok(await service.update(params.id, body), getRequestId(request)),
    {
      body: updateItemSchema,
      params: itemIdParamsSchema,
      detail: {
        summary: "Update item core fields",
        description:
          "Updates mutable item identity fields. Nutrition summary fields are managed from nutrition data.",
        tags: ["Items"],
      },
    },
  )
  .put(
    "/:id/nutrition",
    async ({ params, body, request }) =>
      ok(
        await service.updateNutrition(params.id, body),
        getRequestId(request),
      ),
    {
      body: nutritionPayloadSchema,
      params: itemIdParamsSchema,
      detail: {
        summary: "Update item nutrition",
        description:
          "Upserts full nutrition data and refreshes the quick item summary in one transaction.",
        tags: ["Items"],
      },
    },
  )
  .post(
    "/scan",
    async ({ body, request }) =>
      ok(await ocrService.scan(body), getRequestId(request)),
    {
      body: scanItemSchema,
      detail: {
        summary: "Scan nutrition label",
        description:
          "Submits a nutrition label image to the configured OCR provider and returns a prefilled item payload.",
        tags: ["Items"],
      },
    },
  )
  .post(
    "/scan/confirm",
    async ({ body, request, set }) => {
      set.status = 201;
      return ok(await service.create(body), getRequestId(request));
    },
    {
      body: createItemSchema,
      detail: {
        summary: "Confirm scanned item",
        description:
          "Persists an OCR-extracted payload after client confirmation.",
        tags: ["Items"],
      },
    },
  );
