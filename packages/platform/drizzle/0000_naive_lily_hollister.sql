CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`source_type` text DEFAULT 'vcs' NOT NULL,
	`vcs_provider` text,
	`vcs_namespace` text,
	`vcs_repo` text,
	`vcs_token_enc` text,
	`artifact_name` text DEFAULT 'app.zip' NOT NULL,
	`target_framework` text DEFAULT 'net8.0' NOT NULL,
	`runtime` text DEFAULT 'dotnet' NOT NULL,
	`default_env` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`actor_id` integer,
	`actor_username` text,
	`target_type` text,
	`target_id` text,
	`detail` text,
	`ip` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `deploy_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`app_id` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_used` text,
	`created_by` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deploy_tokens_token_hash_unique` ON `deploy_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`release_id` integer NOT NULL,
	`version` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`triggered_by` integer,
	`started_at` text NOT NULL,
	`finished_at` text,
	`log` text,
	`health_after` text,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `instance_metrics_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`instance_id` text NOT NULL,
	`memory_bytes` integer,
	`cpu_percent` real,
	`restart_count` integer,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `instances` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`app_id` text NOT NULL,
	`server_id` text NOT NULL,
	`domain` text NOT NULL,
	`port` integer NOT NULL,
	`memory_tier` text DEFAULT 'standard' NOT NULL,
	`env_vars` text DEFAULT '{}' NOT NULL,
	`app_path` text NOT NULL,
	`uploads_path` text NOT NULL,
	`current_version` text,
	`health_status` text DEFAULT 'unknown' NOT NULL,
	`runtime_version` text DEFAULT '8.0' NOT NULL,
	`health_check_path` text DEFAULT '/health' NOT NULL,
	`health_check_grace_seconds` integer DEFAULT 10 NOT NULL,
	`last_deployed` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `instances_domain_unique` ON `instances` (`domain`);--> statement-breakpoint
CREATE TABLE `invites` (
	`token` text PRIMARY KEY NOT NULL,
	`email` text,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_by` integer,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbound_webhooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_called_at` text,
	`last_status` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pg_alert_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pg_server_id` text NOT NULL,
	`metric` text NOT NULL,
	`operator` text NOT NULL,
	`threshold` real NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pg_server_id`) REFERENCES `pg_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pg_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pg_server_id` text,
	`rule_id` integer,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`threshold` real NOT NULL,
	`status` text,
	`fired_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`pg_server_id`) REFERENCES `pg_servers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rule_id`) REFERENCES `pg_alert_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pg_metrics_latest` (
	`pg_server_id` text PRIMARY KEY NOT NULL,
	`connections_total` integer,
	`connections_active` integer,
	`connections_idle` integer,
	`connections_waiting` integer,
	`db_size_bytes` integer,
	`cache_hit_ratio` real,
	`tps_commit` real,
	`tps_rollback` real,
	`long_queries` text,
	`replication_lag_bytes` integer,
	`bloat_estimate` text,
	`autovacuum_running` integer,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`pg_server_id`) REFERENCES `pg_servers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pg_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`display_name` text NOT NULL,
	`pg_host` text DEFAULT 'localhost' NOT NULL,
	`pg_port` integer DEFAULT 5432 NOT NULL,
	`pg_user_enc` text NOT NULL,
	`pg_pass_enc` text,
	`pg_database` text DEFAULT 'postgres' NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_checked` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `provision_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`app_id` text NOT NULL,
	`server_id` text,
	`instance_id` text,
	`request_body` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	`triggered_by` integer
);
--> statement-breakpoint
CREATE TABLE `rate_limit_store` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer DEFAULT 0 NOT NULL,
	`reset_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`app_id` text NOT NULL,
	`version` text NOT NULL,
	`github_tag` text NOT NULL,
	`download_url` text NOT NULL,
	`artifact_size` integer,
	`cached_path` text,
	`cached_at` text,
	`release_notes` text,
	`published_at` text NOT NULL,
	`source` text DEFAULT 'vcs' NOT NULL,
	`upload_path` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `server_runtimes` (
	`server_id` text NOT NULL,
	`runtime` text NOT NULL,
	`version` text NOT NULL,
	`installed_at` text NOT NULL,
	PRIMARY KEY(`server_id`, `runtime`, `version`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `server_sdks` (
	`server_id` text NOT NULL,
	`sdk_version` text NOT NULL,
	`runtime_version` text NOT NULL,
	`install_path` text,
	`installed_at` text NOT NULL,
	PRIMARY KEY(`server_id`, `sdk_version`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`hostname` text NOT NULL,
	`agent_port` integer DEFAULT 7823 NOT NULL,
	`agent_cert_pem` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_seen` text,
	`total_memory` integer,
	`total_cpu` integer,
	`disk_total` integer,
	`disk_used` integer,
	`os_info` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`refresh_token` text NOT NULL,
	`expires_at` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`revoked` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_refresh_token_unique` ON `sessions` (`refresh_token`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`is_sensitive` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_backup_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_instance_access` (
	`user_id` integer NOT NULL,
	`instance_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `instance_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`instance_id`) REFERENCES `instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` integer,
	`last_login` text,
	`created_at` text NOT NULL,
	`totp_secret_enc` text,
	`totp_enabled` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);