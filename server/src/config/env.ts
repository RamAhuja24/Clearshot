import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load the repository-root .env when present. Variables already set in the
// process environment win, so tests and deployments can override anything.
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value === '' ? undefined : value))
  .optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  UPLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  UPLOAD_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  QUEUE_PREFIX: z.string().min(1).default('bull'),

  S3_ENDPOINT: optionalString,
  S3_PUBLIC_ENDPOINT: optionalString,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  S3_AUTO_CREATE_BUCKET: z.stringbool().default(false),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  JOB_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  VALIDATION_MIN_FILE_BYTES: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(20 * 1024),
  VALIDATION_MIN_DIMENSION_PX: z.coerce.number().int().positive().default(512),
  VALIDATION_MAX_PIXELS: z.coerce.number().int().positive().default(50_000_000),
  VALIDATION_BLUR_MIN_SCORE: z.coerce.number().nonnegative().default(100),
  VALIDATION_SIMILARITY_MAX_DISTANCE: z.coerce.number().int().min(0).max(64).default(8),
  VALIDATION_FACE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  VALIDATION_FACE_MIN_AREA_RATIO: z.coerce.number().min(0).max(1).default(0.03),
  VALIDATION_REJECT_NO_FACE: z.stringbool().default(true),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration:\n${z.prettifyError(parsed.error)}`);
}
const env = parsed.data;

export const config = {
  env: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  api: {
    port: env.API_PORT,
    clientOrigins: env.CLIENT_ORIGIN.split(',').map((origin) => origin.trim()),
    uploadMaxBytes: env.UPLOAD_MAX_BYTES,
    uploadRateLimitPerMinute: env.UPLOAD_RATE_LIMIT_PER_MINUTE,
  },
  db: { url: env.DATABASE_URL },
  redis: { url: env.REDIS_URL, queuePrefix: env.QUEUE_PREFIX },
  s3: {
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    autoCreateBucket: env.S3_AUTO_CREATE_BUCKET,
    presignTtlSeconds: env.S3_PRESIGN_TTL_SECONDS,
  },
  worker: {
    concurrency: env.WORKER_CONCURRENCY,
    jobAttempts: env.JOB_ATTEMPTS,
  },
  validation: {
    minFileBytes: env.VALIDATION_MIN_FILE_BYTES,
    minDimensionPx: env.VALIDATION_MIN_DIMENSION_PX,
    maxPixels: env.VALIDATION_MAX_PIXELS,
    blurMinScore: env.VALIDATION_BLUR_MIN_SCORE,
    similarityMaxDistance: env.VALIDATION_SIMILARITY_MAX_DISTANCE,
    faceMinConfidence: env.VALIDATION_FACE_MIN_CONFIDENCE,
    faceMinAreaRatio: env.VALIDATION_FACE_MIN_AREA_RATIO,
    rejectNoFace: env.VALIDATION_REJECT_NO_FACE,
  },
} as const;

export type AppConfig = typeof config;
export type S3Config = AppConfig['s3'];
export type ValidationConfig = AppConfig['validation'];
