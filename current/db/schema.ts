import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Operational abuse-prevention state only. This table contains no deal,
 * customer, organization, filename, or source-text data.
 */
export const securityRateLimits = sqliteTable(
  "security_rate_limits",
  {
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    windowStart: integer("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.action, table.windowStart] }),
    index("security_rate_limits_window_start_idx").on(table.windowStart),
  ],
);
