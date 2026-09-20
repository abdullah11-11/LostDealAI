CREATE TABLE `security_rate_limits` (
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`window_start` integer NOT NULL,
	`request_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `action`, `window_start`)
);
--> statement-breakpoint
CREATE INDEX `security_rate_limits_window_start_idx` ON `security_rate_limits` (`window_start`);