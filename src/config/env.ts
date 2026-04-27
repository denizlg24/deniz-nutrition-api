const DEFAULT_API_PORT = 3000;
const DEFAULT_RATE_LIMIT_MAX = 120;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

const readString = (key: string) => Bun.env[key];

const readRequiredString = (key: string) => {
  const value = readString(key);

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

const readNumber = (key: string, fallback: number) => {
  const value = readString(key);

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be a finite number`);
  }

  return parsed;
};

export const env = {
  apiPort: readNumber("API_PORT", DEFAULT_API_PORT),
  databaseUrl: readRequiredString("DATABASE_URL"),
  logLevel: readString("LOG_LEVEL") ?? "info",
  nodeEnv: readString("NODE_ENV") ?? "development",
  ocrServiceUrl: readString("OCR_SERVICE_URL"),
  rateLimitMax: readNumber("RATE_LIMIT_MAX", DEFAULT_RATE_LIMIT_MAX),
  rateLimitWindowMs: readNumber(
    "RATE_LIMIT_WINDOW_MS",
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  ),
  redisUrl: readRequiredString("REDIS_URL"),
} as const;
