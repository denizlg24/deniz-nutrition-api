import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { createGunzip } from "node:zlib";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { items, nutritionData, type NewItem, type NewNutritionData } from "../src/db/schema";

interface ImportArgs {
  file: string;
  start: number;
  limit?: number;
  batchSize: number;
  checkpointPath: string;
  dryRunOutputPath: string;
  minCompleteness: number;
  resume: boolean;
  dryRun: boolean;
}

interface ImportCheckpoint {
  nextStart: number;
  processed: number;
  imported: number;
  skipped: number;
  updatedAt: string;
  file: string;
}

interface ImportableFood {
  item: NewItem;
  nutrition: Omit<NewNutritionData, "itemId">;
  nutritionCompleteness: number;
  matchedNutrients: NutritionValueField[];
}

interface OFFNutriments {
  [key: string]: number | string | undefined;
}

interface OFFProduct {
  code?: string;
  _id?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  brands?: string;
  brand_owner?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  serving_size?: string;
  nutriments?: OFFNutriments;
}

type NutritionValueField = keyof typeof defaultNutritionValues;
const MAX_NUMERIC_12_3_EXCLUSIVE = 1_000_000_000;
const DEFAULT_MIN_NUTRITION_COMPLETENESS = 0.5;
const KJ_PER_KCAL = 4.184;

const defaultNutritionValues = {
  calories: 0,
  water: 0,
  alcohol: 0,
  caffeine: 0,
  cholesterol: 0,
  choline: 0,
  carbs: 0,
  fiber: 0,
  sugar: 0,
  addedSugar: 0,
  polyols: 0,
  fat: 0,
  monoUnsaturated: 0,
  polyUnsaturated: 0,
  omega3: 0,
  omega3Ala: 0,
  omega3Dha: 0,
  omega3Epa: 0,
  omega6: 0,
  saturated: 0,
  transFat: 0,
  protein: 0,
  cysteine: 0,
  histidine: 0,
  isoleucine: 0,
  leucine: 0,
  lysine: 0,
  methionine: 0,
  phenylalanine: 0,
  threonine: 0,
  tryptophan: 0,
  tyrosine: 0,
  valine: 0,
  a: 0,
  b1: 0,
  b2: 0,
  b3: 0,
  b5: 0,
  b6: 0,
  b12: 0,
  c: 0,
  d: 0,
  e: 0,
  k: 0,
  folate: 0,
  calcium: 0,
  copper: 0,
  iron: 0,
  magnesium: 0,
  manganese: 0,
  phosphorus: 0,
  potassium: 0,
  selenium: 0,
  sodium: 0,
  zinc: 0,
} as const satisfies Omit<
  NewNutritionData,
  "itemId" | "servingLabel" | "servingQnty" | "servingUnit"
>;

const nutrientColumns = {
  "energy-kcal_100g": { field: "calories", multiplier: 1 },
  "fat_100g": { field: "fat", multiplier: 1 },
  "saturated-fat_100g": { field: "saturated", multiplier: 1 },
  "monounsaturated-fat_100g": { field: "monoUnsaturated", multiplier: 1 },
  "polyunsaturated-fat_100g": { field: "polyUnsaturated", multiplier: 1 },
  "omega-3-fat_100g": { field: "omega3", multiplier: 1 },
  "omega-6-fat_100g": { field: "omega6", multiplier: 1 },
  "alpha-linolenic-acid_100g": { field: "omega3Ala", multiplier: 1 },
  "docosahexaenoic-acid_100g": { field: "omega3Dha", multiplier: 1 },
  "eicosapentaenoic-acid_100g": { field: "omega3Epa", multiplier: 1 },
  "trans-fat_100g": { field: "transFat", multiplier: 1 },
  "cholesterol_100g": { field: "cholesterol", multiplier: 1_000 },
  "carbohydrates_100g": { field: "carbs", multiplier: 1 },
  "carbohydrates-total_100g": { field: "carbs", multiplier: 1 },
  "sugars_100g": { field: "sugar", multiplier: 1 },
  "added-sugars_100g": { field: "addedSugar", multiplier: 1 },
  "polyols_100g": { field: "polyols", multiplier: 1 },
  "fiber_100g": { field: "fiber", multiplier: 1 },
  "proteins_100g": { field: "protein", multiplier: 1 },
  "sodium_100g": { field: "sodium", multiplier: 1_000 },
  "alcohol_100g": { field: "alcohol", multiplier: 1 },
  "vitamin-a_100g": { field: "a", multiplier: 1_000_000 },
  "vitamin-d_100g": { field: "d", multiplier: 1_000_000 },
  "vitamin-e_100g": { field: "e", multiplier: 1_000 },
  "vitamin-k_100g": { field: "k", multiplier: 1_000_000 },
  "phylloquinone_100g": { field: "k", multiplier: 1_000_000 },
  "vitamin-c_100g": { field: "c", multiplier: 1_000 },
  "vitamin-b1_100g": { field: "b1", multiplier: 1_000 },
  "vitamin-b2_100g": { field: "b2", multiplier: 1_000 },
  "vitamin-pp_100g": { field: "b3", multiplier: 1_000 },
  "vitamin-b6_100g": { field: "b6", multiplier: 1_000 },
  "vitamin-b9_100g": { field: "folate", multiplier: 1_000_000 },
  "folates_100g": { field: "folate", multiplier: 1_000_000 },
  "vitamin-b12_100g": { field: "b12", multiplier: 1_000_000 },
  "pantothenic-acid_100g": { field: "b5", multiplier: 1_000 },
  "potassium_100g": { field: "potassium", multiplier: 1_000 },
  "calcium_100g": { field: "calcium", multiplier: 1_000 },
  "phosphorus_100g": { field: "phosphorus", multiplier: 1_000 },
  "iron_100g": { field: "iron", multiplier: 1_000 },
  "magnesium_100g": { field: "magnesium", multiplier: 1_000 },
  "zinc_100g": { field: "zinc", multiplier: 1_000 },
  "copper_100g": { field: "copper", multiplier: 1_000 },
  "manganese_100g": { field: "manganese", multiplier: 1_000 },
  "selenium_100g": { field: "selenium", multiplier: 1_000_000 },
  "caffeine_100g": { field: "caffeine", multiplier: 1_000 },
  "choline_100g": { field: "choline", multiplier: 1_000 },
  "water_100g": { field: "water", multiplier: 1 },
  "histidine_100g": { field: "histidine", multiplier: 1 },
  "isoleucine_100g": { field: "isoleucine", multiplier: 1 },
  "leucine_100g": { field: "leucine", multiplier: 1 },
  "lysine_100g": { field: "lysine", multiplier: 1 },
  "methionine_100g": { field: "methionine", multiplier: 1 },
  "cystine_100g": { field: "cysteine", multiplier: 1 },
  "cysteine_100g": { field: "cysteine", multiplier: 1 },
  "phenylalanine_100g": { field: "phenylalanine", multiplier: 1 },
  "threonine_100g": { field: "threonine", multiplier: 1 },
  "tryptophan_100g": { field: "tryptophan", multiplier: 1 },
  "tyrosine_100g": { field: "tyrosine", multiplier: 1 },
  "valine_100g": { field: "valine", multiplier: 1 },
} as const satisfies Record<
  string,
  { field: NutritionValueField; multiplier: number }
>;

const completenessFields = [
  "calories",
  "fat",
  "carbs",
  "protein",
  "saturated",
  "sugar",
  "fiber",
  "sodium",
] as const satisfies readonly NutritionValueField[];

const nutrientColumnEntries = Object.entries(nutrientColumns);

const parseArgs = (): ImportArgs => {
  const args = Bun.argv.slice(2);
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);

    const index = args.indexOf(name);
    if (index >= 0) return args[index + 1];

    return undefined;
  };

  return {
    file: getValue("--file") ?? "data/openfoodfacts-products.jsonl",
    start: readPositiveInteger(getValue("--start"), 0),
    limit: readOptionalPositiveInteger(getValue("--limit")),
    batchSize: readPositiveInteger(getValue("--batch-size"), 500),
    checkpointPath:
      getValue("--checkpoint") ??
      ".import-state/openfoodfacts-import-checkpoint.json",
    dryRunOutputPath:
      getValue("--dry-run-output") ??
      "data/openfoodfacts-import-preview.json",
    minCompleteness: readThreshold(
      getValue("--min-completeness"),
      DEFAULT_MIN_NUTRITION_COMPLETENESS,
    ),
    resume: args.includes("--resume"),
    dryRun: args.includes("--dry-run"),
  };
};

const readPositiveInteger = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer, received ${value}`);
  }

  return parsed;
};

const readOptionalPositiveInteger = (value: string | undefined) =>
  value === undefined ? undefined : readPositiveInteger(value, 0);

const readThreshold = (value: string | undefined, fallback: number) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`Expected a threshold from 0 to 1, received ${value}`);
  }

  return parsed;
};

const readCheckpoint = async (path: string): Promise<ImportCheckpoint | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ImportCheckpoint;
  } catch {
    return undefined;
  }
};

const writeCheckpoint = async (
  path: string,
  checkpoint: ImportCheckpoint,
) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(checkpoint, null, 2));
};

const parseNumber = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
};

const servingKeyFor = (key: string) => key.replace(/_100g$/, "_serving");

const readNutrientValue = (
  nutriments: OFFNutriments,
  key: string,
  servingScale: number,
) => {
  const servingValue = parseNumber(nutriments[servingKeyFor(key)]);
  if (servingValue !== undefined) return servingValue;

  const per100gValue = parseNumber(nutriments[key]);
  if (per100gValue !== undefined) return per100gValue * servingScale;

  return undefined;
};

const calculateCompleteness = (matchedFields: Set<NutritionValueField>) => {
  const matches = completenessFields.filter((field) => matchedFields.has(field)).length;
  return roundAmount(matches / completenessFields.length);
};

const parseServing = (product: OFFProduct) => {
  const servingQuantity = parseNumber(product.serving_quantity);
  const servingSize = product.serving_size?.trim() || undefined;

  if (servingQuantity !== undefined) {
    const rawUnit = product.serving_quantity_unit?.trim();
    const unit = rawUnit || servingSize?.replace(String(servingQuantity), "").trim() || "g";

    return {
      quantity: servingQuantity,
      unit,
      label: servingSize || `${servingQuantity} ${unit}`,
    };
  }

  return {
    quantity: 100,
    unit: "g",
    label: "100 g",
  };
};

const mapProduct = (
  product: OFFProduct,
  minCompleteness: number,
): ImportableFood | undefined => {
  const barcode = product.code?.trim() || product._id?.trim();
  const name =
    product.product_name?.trim() ||
    product.product_name_en?.trim() ||
    product.generic_name?.trim();

  if (!barcode || !name) return undefined;

  const nutriments = product.nutriments;
  if (!nutriments) return undefined;

  const serving = parseServing(product);
  const servingScale =
    serving.unit.toLowerCase().startsWith("g") ||
    serving.unit.toLowerCase().startsWith("ml")
      ? serving.quantity / 100
      : 1;

  const nutrition: Omit<NewNutritionData, "itemId"> = {
    ...defaultNutritionValues,
    servingLabel: serving.label,
    servingQnty: serving.quantity,
    servingUnit: serving.unit,
  };
  const matchedFields = new Set<NutritionValueField>();

  for (const [key, config] of nutrientColumnEntries) {
    const value = readNutrientValue(nutriments, key, servingScale);
    if (value === undefined) continue;
    // Don't overwrite a field that was already set by a higher-priority key
    if (nutrition[config.field] !== 0) continue;

    nutrition[config.field] = normalizeDbAmount(
      value * config.multiplier,
    );
    matchedFields.add(config.field);
  }

  if (nutrition.calories === 0) {
    const energyKj = readNutrientValue(nutriments, "energy-kj_100g", servingScale);
    if (energyKj !== undefined) {
      nutrition.calories = normalizeDbAmount(energyKj / KJ_PER_KCAL);
      matchedFields.add("calories");
    }
  }

  nutrition.omega3 = normalizeDbAmount(
    nutrition.omega3 ||
      (nutrition.omega3Ala ?? 0) +
        (nutrition.omega3Dha ?? 0) +
        (nutrition.omega3Epa ?? 0),
  );

  if (nutrition.omega3 > 0) {
    matchedFields.add("omega3");
  }

  const nutritionCompleteness = calculateCompleteness(matchedFields);
  if (nutritionCompleteness < minCompleteness) return undefined;

  return {
    item: {
      barcode,
      name,
      brand:
        product.brands?.trim() ||
        product.brand_owner?.trim() ||
        null,
      servingLabel: nutrition.servingLabel,
      caloriesPerServing: nutrition.calories,
      proteinPerServing: nutrition.protein,
      carbsPerServing: nutrition.carbs,
      fatPerServing: nutrition.fat,
    },
    nutrition,
    nutritionCompleteness,
    matchedNutrients: [...matchedFields].sort(),
  };
};

const roundAmount = (value: number) => Math.round(value * 1_000) / 1_000;

const normalizeDbAmount = (value: number) => {
  const rounded = roundAmount(value);

  if (
    !Number.isFinite(rounded) ||
    Math.abs(rounded) >= MAX_NUMERIC_12_3_EXCLUSIVE ||
    rounded < 0
  ) {
    return 0;
  }

  return rounded;
};

const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);

  const cause = error.cause;
  if (cause instanceof Error) {
    return `${error.message}: ${cause.message}`;
  }

  return error.message;
};

const importBatch = async (
  database: ReturnType<typeof drizzle>,
  batch: ImportableFood[],
) => {
  let upserted = 0;
  let failed = 0;

  for (const entry of batch) {
    try {
      await database.transaction(async (transaction) => {
        const now = new Date();
        const [item] = await transaction
          .insert(items)
          .values(entry.item)
          .onConflictDoUpdate({
            target: items.barcode,
            set: {
              ...entry.item,
              updatedAt: now,
            },
          })
          .returning({ id: items.id });

        if (!item) {
          throw new Error("Failed to upsert item");
        }

        await transaction
          .insert(nutritionData)
          .values({
            ...entry.nutrition,
            itemId: item.id,
          })
          .onConflictDoUpdate({
            target: nutritionData.itemId,
            set: {
              ...entry.nutrition,
              updatedAt: now,
            },
          });

        upserted += 1;
      });
    } catch (error) {
      failed += 1;
      console.warn(
        `Skipping barcode=${entry.item.barcode}: ${describeError(error)}`,
      );
    }
  }

  return { upserted, failed };
};

const replaceBatchEntry = (batch: ImportableFood[], entry: ImportableFood) => {
  const dedupeKey = entry.item.barcode.toLowerCase();
  const existingIndex = batch.findIndex(
    (candidate) => candidate.item.barcode.toLowerCase() === dedupeKey,
  );

  if (existingIndex >= 0) {
    batch[existingIndex] = entry;
    return true;
  }

  batch.push(entry);
  return false;
};

const writeDryRunOutput = async (
  args: ImportArgs,
  entries: Iterable<ImportableFood>,
) => {
  const foods = [...entries].map((entry) => ({
    item: entry.item,
    nutrition: entry.nutrition,
    nutritionCompleteness: entry.nutritionCompleteness,
    matchedNutrients: entry.matchedNutrients,
  }));

  await mkdir(dirname(args.dryRunOutputPath), { recursive: true });
  await writeFile(
    args.dryRunOutputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        file: args.file,
        start: args.start,
        limit: args.limit ?? null,
        minCompleteness: args.minCompleteness,
        count: foods.length,
        foods,
      },
      null,
      2,
    ),
  );
};

const prepareDatabaseDedupe = async (database: ReturnType<typeof drizzle>) => {
  const deleted = await database.execute(sql`
    WITH duplicate_items AS (
      SELECT
        id,
        row_number() OVER (
          PARTITION BY barcode
          ORDER BY created_at ASC, id ASC
        ) AS duplicate_rank
      FROM items
    ),
    deleted_items AS (
      DELETE FROM items
      WHERE id IN (
        SELECT id
        FROM duplicate_items
        WHERE duplicate_rank > 1
      )
      RETURNING id
    )
    SELECT count(*)::int AS deleted_count
    FROM deleted_items
  `);
  const deletedCount = Number(deleted.rows[0]?.deleted_count ?? 0);

  await database.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS items_barcode_idx
    ON items USING btree (barcode)
  `);

  if (deletedCount > 0) {
    console.log(`Deduplicated existing items by barcode: deleted=${deletedCount}`);
  }
};

const main = async () => {
  const args = parseArgs();
  const checkpoint = await readCheckpoint(args.checkpointPath);
  const start = args.resume ? checkpoint?.nextStart ?? 0 : args.start;
  const databaseUrl = Bun.env.DATABASE_URL;

  if (!args.dryRun && !databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
        max: 5,
      })
    : undefined;
  const database = pool ? drizzle(pool) : undefined;

  if (!args.dryRun && database) {
    await prepareDatabaseDedupe(database);
  }

  const fileStream = createReadStream(args.file);
  const input = args.file.endsWith(".gz")
    ? fileStream.pipe(createGunzip())
    : fileStream;
  const lines = createInterface({ input, crlfDelay: Infinity });

  const batch: ImportableFood[] = [];
  const dryRunEntriesByBarcode = new Map<string, ImportableFood>();
  let index = 0;
  let processed = 0;
  let imported = 0;
  let skipped = 0;
  let replaced = 0;

  console.log(
    `Starting OpenFoodFacts import: file=${args.file} start=${start} limit=${
      args.limit ?? "none"
    } batchSize=${args.batchSize} minCompleteness=${args.minCompleteness}`,
  );

  try {
    for await (const line of lines) {
      if (!line.trim()) continue;

      if (index < start) {
        index += 1;
        continue;
      }

      if (args.limit !== undefined && processed >= args.limit) {
        break;
      }

      processed += 1;
      index += 1;

      let product: OFFProduct;
      try {
        product = JSON.parse(line) as OFFProduct;
      } catch {
        skipped += 1;
        continue;
      }

      const mapped = mapProduct(product, args.minCompleteness);

      if (!mapped) {
        skipped += 1;
        continue;
      }

      const dedupeKey = mapped.item.barcode.toLowerCase();

      if (args.dryRun) {
        if (dryRunEntriesByBarcode.has(dedupeKey)) {
          replaced += 1;
        }
        dryRunEntriesByBarcode.set(dedupeKey, mapped);
      }

      if (replaceBatchEntry(batch, mapped) && !args.dryRun) {
        replaced += 1;
      }

      if (batch.length >= args.batchSize) {
        if (args.dryRun) {
          imported += batch.length;
        } else if (database) {
          const result = await importBatch(database, batch);
          imported += result.upserted;
          skipped += result.failed;
        }
        batch.length = 0;

        if (!args.dryRun) {
          await writeCheckpoint(args.checkpointPath, {
            nextStart: index,
            processed,
            imported,
            skipped,
            updatedAt: new Date().toISOString(),
            file: args.file,
          });
        }
        console.log(
          `nextStart=${index} processed=${processed} imported=${imported} skipped=${skipped} replaced=${replaced}`,
        );
      }
    }

    if (batch.length > 0) {
      if (args.dryRun) {
        imported += batch.length;
      } else if (database) {
        const result = await importBatch(database, batch);
        imported += result.upserted;
        skipped += result.failed;
      }
    }

    if (args.dryRun) {
      imported = dryRunEntriesByBarcode.size;
    }

    if (!args.dryRun) {
      await writeCheckpoint(args.checkpointPath, {
        nextStart: index,
        processed,
        imported,
        skipped,
        updatedAt: new Date().toISOString(),
        file: args.file,
      });
    }

    if (args.dryRun) {
      await writeDryRunOutput(args, dryRunEntriesByBarcode.values());
      console.log(`Wrote dry-run output: ${args.dryRunOutputPath}`);
    }
  } finally {
    lines.close();
    input.destroy();
    fileStream.destroy();
    await pool?.end();
  }

  console.log(
    `Finished OpenFoodFacts import: nextStart=${index} processed=${processed} imported=${imported} skipped=${skipped} replaced=${replaced}`,
  );
};

await main();
