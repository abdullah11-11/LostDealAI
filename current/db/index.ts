import "server-only";

import { env } from "cloudflare:workers";

export type D1Statement = {
  bind(...values: unknown[]): D1Statement;
};

export type D1QueryResult<T> = {
  results?: T[];
};

export type RateLimitD1Database = {
  prepare(query: string): D1Statement;
  batch<T>(statements: D1Statement[]): Promise<Array<D1QueryResult<T>>>;
};

export function getRateLimitDatabase(): RateLimitD1Database {
  const database = (env as { DB?: RateLimitD1Database }).DB;
  if (!database) throw new Error("RATE_LIMIT_BACKEND_UNAVAILABLE");
  return database;
}
