import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../db/client";
import {
  items,
  nutritionData,
  type Item,
  type NewItem,
  type NewNutritionData,
  type NutritionData,
  type SupportedLanguage,
  supportedLanguages,
} from "../../db/schema";

export type ItemSummary = Pick<
  Item,
  | "id"
  | "barcode"
  | "name"
  | "brand"
  | "servingLabel"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
  | "createdAt"
  | "updatedAt"
>;

export interface ItemSearchResult extends ItemSummary {
  rank: number;
  score: number;
}

export type ItemSummaryInput = Pick<
  NewItem,
  | "servingLabel"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
>;

const itemSummarySelect = {
  id: items.id,
  barcode: items.barcode,
  name: items.name,
  brand: items.brand,
  servingLabel: items.servingLabel,
  caloriesPerServing: items.caloriesPerServing,
  proteinPerServing: items.proteinPerServing,
  carbsPerServing: items.carbsPerServing,
  fatPerServing: items.fatPerServing,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
};

export interface ItemSearchInput {
  query?: string;
  brand?: string;
}

const nameSearchVectorColumns: Record<SupportedLanguage, SQL> = {
  english: sql`${items.searchVectorEnglish}`,
  portuguese: sql`${items.searchVectorPortuguese}`,
  spanish: sql`${items.searchVectorSpanish}`,
  french: sql`${items.searchVectorFrench}`,
};

const brandSearchVectorColumns: Record<SupportedLanguage, SQL> = {
  english: sql`${items.brandSearchVectorEnglish}`,
  portuguese: sql`${items.brandSearchVectorPortuguese}`,
  spanish: sql`${items.brandSearchVectorSpanish}`,
  french: sql`${items.brandSearchVectorFrench}`,
};

const buildSearchVector = (
  columns: Record<SupportedLanguage, SQL>,
  priorityLanguage: SupportedLanguage,
) => {
  const secondaryLanguages = supportedLanguages.filter(
    (language) => language !== priorityLanguage,
  );

  return sql`
    setweight(${columns[priorityLanguage]}, 'A') ||
    setweight(${columns[secondaryLanguages[0]]}, 'B') ||
    setweight(${columns[secondaryLanguages[1]]}, 'B') ||
    setweight(${columns[secondaryLanguages[2]]}, 'B')
  `;
};

export class ItemsRepository {
  constructor(private readonly database: Database) {}

  async search(
    input: ItemSearchInput,
    language: SupportedLanguage,
    limit: number | undefined,
    minScore: number,
  ): Promise<ItemSearchResult[]> {
    const query = input.query?.trim();
    const brand = input.brand?.trim();
    const nameSearchVector = buildSearchVector(nameSearchVectorColumns, language);
    const brandSearchVector = buildSearchVector(
      brandSearchVectorColumns,
      language,
    );
    const nameTsQuery = query
      ? sql`websearch_to_tsquery(${language}::regconfig, ${query})`
      : undefined;
    const brandTsQuery = brand
      ? sql`websearch_to_tsquery(${language}::regconfig, ${brand})`
      : undefined;
    const nameRank = nameTsQuery
      ? sql<number>`ts_rank_cd(${nameSearchVector}, ${nameTsQuery})`
      : sql<number>`0`;
    const brandRank = brandTsQuery
      ? sql<number>`ts_rank_cd(${brandSearchVector}, ${brandTsQuery})`
      : sql<number>`0`;
    const rank = sql<number>`(${nameRank} + ${brandRank})`;
    const normalizedQuery = query?.toLowerCase();
    const normalizedBrand = brand?.toLowerCase();
    const nameScore = normalizedQuery
      ? sql<number>`case
          when lower(${items.name}) = ${normalizedQuery} then 3
          when lower(${items.name}) like '%' || ${normalizedQuery} || '%' then 1.5
          else 0
        end`
      : sql<number>`0`;
    const brandScore = normalizedBrand
      ? sql<number>`case
          when lower(${items.brand}) = ${normalizedBrand} then 2
          when lower(${items.brand}) like '%' || ${normalizedBrand} || '%' then 1
          else 0
        end`
      : sql<number>`0`;
    const score = sql<number>`(
      ${rank}
      + ${nameScore}
      + ${brandScore}
    )`;
    const conditions = [
      ...(nameTsQuery ? [sql`${nameSearchVector} @@ ${nameTsQuery}`] : []),
      ...(brandTsQuery ? [sql`${brandSearchVector} @@ ${brandTsQuery}`] : []),
      sql`${score} >= ${minScore}`,
    ];

    const search = this.database
      .select({
        ...itemSummarySelect,
        rank,
        score,
      })
      .from(items)
      .where(and(...conditions))
      .orderBy(sql`${score} desc`, sql`${rank} desc`, asc(items.name))
      .$dynamic();

    if (limit !== undefined) {
      return search.limit(limit);
    }

    return search;
  }

  async findById(id: string): Promise<ItemSummary | undefined> {
    const [item] = await this.database
      .select(itemSummarySelect)
      .from(items)
      .where(eq(items.id, id))
      .limit(1);

    return item;
  }

  async findByBarcode(barcode: string): Promise<ItemSummary | undefined> {
    const [item] = await this.database
      .select(itemSummarySelect)
      .from(items)
      .where(eq(items.barcode, barcode))
      .limit(1);

    return item;
  }

  async findNutritionByItemId(
    itemId: string,
  ): Promise<NutritionData | undefined> {
    const [nutrition] = await this.database
      .select()
      .from(nutritionData)
      .where(eq(nutritionData.itemId, itemId))
      .limit(1);

    return nutrition;
  }

  async create(
    itemInput: NewItem,
    nutritionInput: Omit<NewNutritionData, "itemId">,
  ) {
    return this.database.transaction(async (transaction) => {
      const [createdItem] = await transaction
        .insert(items)
        .values(itemInput)
        .returning(itemSummarySelect);

      if (!createdItem) {
        throw new Error("Failed to create item");
      }

      const [createdNutrition] = await transaction
        .insert(nutritionData)
        .values({
          ...nutritionInput,
          itemId: createdItem.id,
        })
        .returning();

      return {
        item: createdItem,
        nutrition: createdNutrition,
      };
    });
  }

  async updateItem(
    id: string,
    input: Partial<NewItem>,
  ): Promise<ItemSummary | undefined> {
    const [item] = await this.database
      .update(items)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(items.id, id))
      .returning(itemSummarySelect);

    return item;
  }

  async upsertNutrition(
    itemId: string,
    input: Omit<NewNutritionData, "itemId">,
    summary: ItemSummaryInput,
  ): Promise<{ item: ItemSummary; nutrition: NutritionData }> {
    return this.database.transaction(async (transaction) => {
      const now = new Date();
      const [nutrition] = await transaction
        .insert(nutritionData)
        .values({
          ...input,
          itemId,
        })
        .onConflictDoUpdate({
          target: nutritionData.itemId,
          set: {
            ...input,
            updatedAt: now,
          },
        })
        .returning();

      if (!nutrition) {
        throw new Error("Failed to upsert nutrition data");
      }

      const [item] = await transaction
        .update(items)
        .set({
          ...summary,
          updatedAt: now,
        })
        .where(eq(items.id, itemId))
        .returning(itemSummarySelect);

      if (!item) {
        throw new Error("Failed to update item nutrition summary");
      }

      return {
        item,
        nutrition,
      };
    });
  }
}
