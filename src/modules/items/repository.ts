import { asc, eq, sql, type SQL } from "drizzle-orm";

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

const searchVectorColumns: Record<SupportedLanguage, SQL> = {
  english: sql`${items.searchVectorEnglish}`,
  portuguese: sql`${items.searchVectorPortuguese}`,
  spanish: sql`${items.searchVectorSpanish}`,
  french: sql`${items.searchVectorFrench}`,
};

const buildSearchVector = (priorityLanguage: SupportedLanguage) => {
  const secondaryLanguages = supportedLanguages.filter(
    (language) => language !== priorityLanguage,
  );

  return sql`
    setweight(${searchVectorColumns[priorityLanguage]}, 'A') ||
    setweight(${searchVectorColumns[secondaryLanguages[0]]}, 'B') ||
    setweight(${searchVectorColumns[secondaryLanguages[1]]}, 'B') ||
    setweight(${searchVectorColumns[secondaryLanguages[2]]}, 'B')
  `;
};

export class ItemsRepository {
  constructor(private readonly database: Database) {}

  async search(
    query: string,
    language: SupportedLanguage,
    limit: number,
  ): Promise<ItemSearchResult[]> {
    const searchVector = buildSearchVector(language);
    const tsQuery = sql`websearch_to_tsquery(${language}::regconfig, ${query})`;
    const rank = sql<number>`ts_rank_cd(${searchVector}, ${tsQuery})`;

    return this.database
      .select({
        ...itemSummarySelect,
        rank,
      })
      .from(items)
      .where(sql`${searchVector} @@ ${tsQuery}`)
      .orderBy(sql`${rank} desc`, asc(items.name))
      .limit(limit);
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
