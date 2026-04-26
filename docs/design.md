# deniz-nutrition-api

## Goal

This system will serve clients with various nutrition data. Users will be able to request nutrition data via text search or barcode lookup. Users will also be able to contribute to the database through image recognition of nutrition labels or by manually entering data.

---

## Technology

| Layer | Choice |
|---|---|
| **Package Manager** | [Bun](https://bun.sh/) |
| **Framework** | [Elysia.js](https://elysiajs.com/) |
| **Database** | PostgreSQL |

---

## Data Models

### `item`

The lightweight, searchable representation of a food product.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID / serial | Primary key |
| `barcode` | text | Primary key |
| `name` | text | Product name |
| `brand` | text | Optional |
| `serving_label` | text | Human-readable serving description (e.g. "1 cup") |
| `calories_per_serving` | numeric | |
| `protein_per_serving` | numeric | |
| `carbs_per_serving` | numeric | |
| `fat_per_serving` | numeric | |

---

### `nutrition_data`

The full, detailed nutrition breakdown linked to an item.

#### General

| Column | Notes |
|---|---|
| `item_id` | Foreign key → `item.id` |
| `serving_label` | Human-readable label |
| `serving_qnty` | Numeric quantity |
| `serving_unit` | e.g. `g`, `ml`, `oz` |
| `calories` | |
| `water` | |
| `alcohol` | |
| `caffeine` | |
| `cholesterol` | |
| `choline` | |

#### Carbohydrates

| Column |
|---|
| `carbs` |
| `fiber` |
| `sugar` |
| `added_sugar` |
| `polyols` |

#### Fats

| Column |
|---|
| `fat` |
| `mono_unsaturated` |
| `poly_unsaturated` |
| `omega_3` |
| `omega_3_ala` |
| `omega_3_dha` |
| `omega_3_epa` |
| `omega_6` |
| `saturated` |
| `trans_fat` |

#### Protein & Amino Acids

| Column |
|---|
| `protein` |
| `cysteine` |
| `histidine` |
| `isoleucine` |
| `leucine` |
| `lysine` |
| `methionine` |
| `phenylalanine` |
| `threonine` |
| `tryptophan` |
| `tyrosine` |
| `valine` |

#### Vitamins

| Column | Vitamin |
|---|---|
| `a` | Vitamin A |
| `b1` | Thiamine |
| `b2` | Riboflavin |
| `b3` | Niacin |
| `b5` | Pantothenic Acid |
| `b6` | Pyridoxine |
| `b12` | Cobalamin |
| `c` | Vitamin C |
| `d` | Vitamin D |
| `e` | Vitamin E |
| `k` | Vitamin K |
| `folate` | Folate / B9 |

#### Minerals

| Column |
|---|
| `calcium` |
| `copper` |
| `iron` |
| `magnesium` |
| `manganese` |
| `phosphorus` |
| `potassium` |
| `selenium` |
| `sodium` |
| `zinc` |

---

### Indexes

A `tsvector` full-text search index is built on the concatenation of `name` and `brand` for each supported language:

**Supported languages:** `english`, `portuguese`, `spanish`, `french`

**Query behavior:**
- The caller provides an optional `lang` parameter.
- If provided, that language's `tsvector` is prioritized (highest weight), then concatenated with the remaining languages.
- If no language is provided, `english` is used as the highest priority.

---

## API Endpoints

### Items — Search & Lookup

| Method | Path | Description |
|---|---|---|
| `GET` | `/items/search?q={query}&lang={lang}` | Full-text search for items by name/brand |
| `GET` | `/items/barcode/{barcode}` | Look up an item by barcode |
| `GET` | `/items/{id}` | Get item summary by ID |
| `GET` | `/items/{id}/nutrition` | Get full nutrition data for an item |

### Items — Contribution

| Method | Path | Description |
|---|---|---|
| `POST` | `/items` | Manually create a new item with nutrition data |
| `PUT` | `/items/{id}` | Update an existing item's core fields |
| `PUT` | `/items/{id}/nutrition` | Update full nutrition data for an item |
| `POST` | `/items/scan` | Submit a nutrition label image for OCR processing; returns a prefilled item payload for confirmation |
| `POST` | `/items/scan/confirm` | Confirm and persist the OCR-extracted nutrition data |