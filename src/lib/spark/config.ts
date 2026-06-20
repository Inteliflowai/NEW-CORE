// src/lib/spark/config.ts
// SPARK integration config. Mirrors the repo's env idiom (src/lib/ai/models.ts):
// read process.env at module top-level with a sensible default. There is no
// central config module — these two exports are the SPARK config surface.
export const SPARK_API_URL = process.env.SPARK_API_URL || 'https://spark.inteliflowai.com';
export const CORE_SPARK_API_SECRET = process.env.CORE_SPARK_API_SECRET || '';
