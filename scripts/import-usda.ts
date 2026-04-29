import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { createInterface } from "node:readline/promises";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";

import { items, nutritionData, type NewItem, type NewNutritionData } from "../src/db/schema";

type SourceName = "foundation" | "branded";

interface ImportArgs {
  source: SourceName | "all";
  start: number;
  limit?: number;
  batchSize: number;
  checkpointPath: string;
  resume: boolean;
  dryRun: boolean;
}

interface ImportCheckpoint {
  sources: Partial<Record<SourceName, SourceCheckpoint>>;
}

interface SourceCheckpoint {
  nextStart: number;
  processed: number;
  imported: number;
  skipped: number;
  updatedAt: string;
  file: string;
}

interface UsdaFood {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  gtinUpc?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFullText?: string;
  foodNutrients?: UsdaFoodNutrient[];
  labelNutrients?: Record<string, { value?: number }>;
}

interface UsdaFoodNutrient {
  amount?: number;
  nutrient?: {
    id?: number;
    number?: string;
    name?: string;
    unitName?: string;
  };
}

interface ImportableFood {
  item: NewItem;
  nutrition: Omit<NewNutritionData, "itemId">;
}

const sources = {
  foundation: {
    file: "data/FoodData_Central_foundation_food_json_2025-12-18.json",
    arrayKey: "FoundationFoods",
  },
  branded: {
    file: "data/FoodData_Central_branded_food_json_2025-12-18.json",
    arrayKey: "BrandedFoods",
  },
} as const satisfies Record<SourceName, { file: string; arrayKey: string }>;

const nutrientFieldById = {
  1003: "protein",
  1004: "fat",
  1005: "carbs",
  1008: "calories",
  1018: "alcohol",
  1050: "carbs",
  1051: "water",
  1057: "caffeine",
  1063: "sugar",
  1079: "fiber",
  1087: "calcium",
  1089: "iron",
  1090: "magnesium",
  1091: "phosphorus",
  1092: "potassium",
  1093: "sodium",
  1095: "zinc",
  1098: "copper",
  1101: "manganese",
  1103: "selenium",
  1106: "a",
  1109: "e",
  1114: "d",
  1162: "c",
  1165: "b1",
  1166: "b2",
  1167: "b3",
  1170: "b5",
  1175: "b6",
  1177: "folate",
  1178: "b12",
  1180: "choline",
  1185: "k",
  1210: "tryptophan",
  1211: "threonine",
  1212: "isoleucine",
  1213: "leucine",
  1214: "lysine",
  1215: "methionine",
  1216: "cysteine",
  1217: "phenylalanine",
  1218: "tyrosine",
  1219: "valine",
  1235: "addedSugar",
  1253: "cholesterol",
  1257: "transFat",
  1258: "saturated",
  1272: "omega3Dha",
  1278: "omega3Epa",
  1292: "monoUnsaturated",
  1293: "polyUnsaturated",
  1404: "omega3Ala",
  2000: "sugar",
} as const satisfies Record<number, keyof Omit<NewNutritionData, "itemId">>;

const labelNutrientField = {
  calories: "calories",
  fat: "fat",
  saturatedFat: "saturated",
  transFat: "transFat",
  cholesterol: "cholesterol",
  sodium: "sodium",
  carbohydrates: "carbs",
  fiber: "fiber",
  sugars: "sugar",
  addedSugars: "addedSugar",
  protein: "protein",
  calcium: "calcium",
  iron: "iron",
  potassium: "potassium",
  vitaminD: "d",
} as const satisfies Record<string, keyof Omit<NewNutritionData, "itemId">>;

type NutritionValueField = keyof typeof defaultNutritionValues;
const MAX_NUMERIC_12_3_EXCLUSIVE = 1_000_000_000;
const KJ_PER_KCAL = 4.184;
const energyKcalNutrientIds = new Set([1008, 2047, 2048]);
const energyKjNutrientIds = new Set([1062]);

const getNutrientField = (id: number): NutritionValueField | undefined =>
  Object.prototype.hasOwnProperty.call(nutrientFieldById, id)
    ? nutrientFieldById[id as keyof typeof nutrientFieldById]
    : undefined;

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

  const source = getValue("--source") ?? "all";

  if (!["foundation", "branded", "all"].includes(source)) {
    throw new Error("--source must be foundation, branded, or all");
  }

  return {
    source: source as ImportArgs["source"],
    start: readPositiveInteger(getValue("--start"), 0),
    limit: readOptionalPositiveInteger(getValue("--limit")),
    batchSize: readPositiveInteger(getValue("--batch-size"), 500),
    checkpointPath:
      getValue("--checkpoint") ?? ".import-state/usda-import-checkpoint.json",
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

const readCheckpoint = async (path: string): Promise<ImportCheckpoint> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ImportCheckpoint;
  } catch {
    return { sources: {} };
  }
};

const writeCheckpoint = async (
  path: string,
  checkpoint: ImportCheckpoint,
) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(checkpoint, null, 2));
};

const cleanJsonLine = (line: string) => {
  const trimmed = line.trim();

  if (!trimmed.startsWith("{") || trimmed.includes('Foods": [')) {
    return undefined;
  }

  return trimmed.endsWith(",") ? trimmed.slice(0, -1) : trimmed;
};

const isUsdaFood = (value: unknown): value is UsdaFood => {
  if (!value || typeof value !== "object") return false;
  const food = value as Partial<UsdaFood>;
  return typeof food.fdcId === "number" && typeof food.description === "string";
};

const finiteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const nutrientAmountById = (food: UsdaFood, servingScale: number) => {
  const mapped: Partial<Record<NutritionValueField, number>> = {};
  let energyKcal: number | undefined;
  let energyKj: number | undefined;

  for (const foodNutrient of food.foodNutrients ?? []) {
    const nutrientId = foodNutrient.nutrient?.id;
    const amount = finiteNumber(foodNutrient.amount);

    if (!nutrientId || amount === undefined) continue;

    if (energyKcalNutrientIds.has(nutrientId)) {
      energyKcal = amount;
      continue;
    }

    if (energyKjNutrientIds.has(nutrientId)) {
      energyKj = amount;
      continue;
    }

    const field = getNutrientField(nutrientId);
    if (!field) continue;

    mapped[field] = normalizeDbAmount(amount * servingScale);
  }

  if (energyKcal !== undefined) {
    mapped.calories = normalizeDbAmount(energyKcal * servingScale);
  } else if (energyKj !== undefined) {
    mapped.calories = normalizeDbAmount((energyKj / KJ_PER_KCAL) * servingScale);
  }

  mapped.omega3 = normalizeDbAmount(
    (mapped.omega3Ala ?? 0) + (mapped.omega3Dha ?? 0) + (mapped.omega3Epa ?? 0),
  );

  if (mapped.omega6 === undefined) {
    const linoleic = food.foodNutrients?.find(
      (entry) => entry.nutrient?.id === 1316,
    );
    mapped.omega6 = normalizeDbAmount(
      (finiteNumber(linoleic?.amount) ?? 0) * servingScale,
    );
  }

  return mapped;
};

const labelNutrients = (food: UsdaFood) => {
  const mapped: Partial<Record<keyof typeof defaultNutritionValues, number>> = {};

  for (const [labelKey, field] of Object.entries(labelNutrientField)) {
    const value = finiteNumber(food.labelNutrients?.[labelKey]?.value);
    if (value !== undefined) mapped[field] = normalizeDbAmount(value);
  }

  return mapped;
};

const mapFood = (food: UsdaFood, source: SourceName): ImportableFood | undefined => {
  const name = food.description.trim();
  if (!name) return undefined;

  const servingQnty = finiteNumber(food.servingSize) ?? 100;
  const servingUnit = food.servingSizeUnit?.trim() || "g";
  const servingLabel =
    food.householdServingFullText?.trim() || `${servingQnty} ${servingUnit}`;
  const servingScale =
    source === "branded" && servingUnit.toLowerCase() === "g"
      ? servingQnty / 100
      : 1;
  const fromNutrients = nutrientAmountById(food, source === "branded" ? servingScale : 1);
  const fromLabel = source === "branded" ? labelNutrients(food) : {};
  const nutrition = {
    ...defaultNutritionValues,
    ...fromNutrients,
    ...fromLabel,
    servingLabel,
    servingQnty,
    servingUnit,
  } satisfies Omit<NewNutritionData, "itemId">;
  const barcode = food.gtinUpc?.trim() || `usda:${source}:${food.fdcId}`;

  return {
    item: {
      barcode,
      name,
      brand: food.brandOwner?.trim() || food.brandName?.trim() || null,
      servingLabel,
      caloriesPerServing: nutrition.calories,
      proteinPerServing: nutrition.protein,
      carbsPerServing: nutrition.carbs,
      fatPerServing: nutrition.fat,
    },
    nutrition,
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

const importBatch = async (
  database: ReturnType<typeof drizzle>,
  batch: ImportableFood[],
) => {
  let inserted = 0;
  let duplicates = 0;
  let failed = 0;

  for (const entry of batch) {
    try {
      await database.transaction(async (transaction) => {
      const [item] = await transaction
        .insert(items)
        .values(entry.item)
        .onConflictDoNothing({ target: items.barcode })
        .returning({ id: items.id });

      if (!item) {
        duplicates += 1;
        return;
      }

      await transaction
        .insert(nutritionData)
        .values({
          ...entry.nutrition,
          itemId: item.id,
        })
        .onConflictDoNothing({ target: nutritionData.itemId });

      inserted += 1;
      });
    } catch (error) {
      failed += 1;
      console.warn(
        `Skipping barcode=${entry.item.barcode}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return { inserted, duplicates, failed };
};

const importSource = async (
  database: ReturnType<typeof drizzle>,
  source: SourceName,
  args: ImportArgs,
  checkpoint: ImportCheckpoint,
) => {
  const sourceConfig = sources[source];
  const checkpointStart = checkpoint.sources[source]?.nextStart ?? 0;
  const start = args.resume ? checkpointStart : args.start;
  const stream = createReadStream(sourceConfig.file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  const batch: ImportableFood[] = [];
  let index = 0;
  let processed = 0;
  let imported = 0;
  let skipped = 0;

  console.log(
    `Starting USDA import: source=${source} file=${basename(
      sourceConfig.file,
    )} start=${start} limit=${args.limit ?? "none"} batchSize=${args.batchSize}`,
  );

  for await (const line of lines) {
    const json = cleanJsonLine(line);
    if (!json) continue;

    if (index < start) {
      index += 1;
      continue;
    }

    if (args.limit !== undefined && processed >= args.limit) {
      break;
    }

    processed += 1;
    index += 1;

    try {
      const parsed = JSON.parse(json) as unknown;

      if (!isUsdaFood(parsed)) {
        skipped += 1;
        continue;
      }

      const mapped = mapFood(parsed, source);

      if (!mapped) {
        skipped += 1;
        continue;
      }

      batch.push(mapped);

      if (batch.length >= args.batchSize) {
        if (args.dryRun) {
          imported += batch.length;
        } else {
          const result = await importBatch(database, batch);
          imported += result.inserted;
          skipped += result.duplicates + result.failed;
        }
        batch.length = 0;
        checkpoint.sources[source] = {
          nextStart: index,
          processed,
          imported,
          skipped,
          updatedAt: new Date().toISOString(),
          file: sourceConfig.file,
        };
        await writeCheckpoint(args.checkpointPath, checkpoint);
        console.log(
          `source=${source} nextStart=${index} processed=${processed} imported=${imported} skipped=${skipped}`,
        );
      }
    } catch (error) {
      skipped += 1;
      console.warn(
        `Skipping source=${source} index=${index - 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (batch.length > 0) {
    if (args.dryRun) {
      imported += batch.length;
    } else {
      const result = await importBatch(database, batch);
      imported += result.inserted;
      skipped += result.duplicates + result.failed;
    }
  }

  checkpoint.sources[source] = {
    nextStart: index,
    processed,
    imported,
    skipped,
    updatedAt: new Date().toISOString(),
    file: sourceConfig.file,
  };
  await writeCheckpoint(args.checkpointPath, checkpoint);

  console.log(
    `Finished USDA import: source=${source} nextStart=${index} processed=${processed} imported=${imported} skipped=${skipped}`,
  );
};

const main = async () => {
  const args = parseArgs();
  const databaseUrl = Bun.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 5,
  });
  const database = drizzle(pool);
  const checkpoint = await readCheckpoint(args.checkpointPath);
  const selectedSources: SourceName[] =
    args.source === "all" ? ["foundation", "branded"] : [args.source];

  try {
    for (const source of selectedSources) {
      await importSource(database, source, args, checkpoint);
    }
  } finally {
    await pool.end();
  }
};

await main();
