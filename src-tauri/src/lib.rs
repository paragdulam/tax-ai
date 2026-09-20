use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create statements table",
            sql: "CREATE TABLE IF NOT EXISTS statements (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                file_type TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                content_base64 TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create transactions table",
            sql: "CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                statement_id TEXT NOT NULL,
                date TEXT NOT NULL,
                description TEXT NOT NULL,
                amount REAL NOT NULL,
                category TEXT NOT NULL DEFAULT 'Uncategorized',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_transactions_statement_id ON transactions (statement_id);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add account_type to statements",
            sql: "ALTER TABLE statements ADD COLUMN account_type TEXT NOT NULL DEFAULT 'unknown';",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add content_hash to statements for duplicate-file detection",
            sql: "ALTER TABLE statements ADD COLUMN content_hash TEXT;
            CREATE INDEX IF NOT EXISTS idx_statements_content_hash ON statements (content_hash);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "add bank_name and account_last4 to statements",
            sql: "ALTER TABLE statements ADD COLUMN bank_name TEXT;
            ALTER TABLE statements ADD COLUMN account_last4 TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add currency to statements",
            sql: "ALTER TABLE statements ADD COLUMN currency TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "add transfer_group_id to transactions and reset categories for new classification vocabulary",
            sql: "ALTER TABLE transactions ADD COLUMN transfer_group_id TEXT;
            CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group_id ON transactions (transfer_group_id);
            UPDATE transactions SET category = 'Uncategorized';",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "remove inter-account transfer feature: reset tagged rows to Uncategorized and drop transfer_group_id",
            sql: "UPDATE transactions SET category = 'Uncategorized' WHERE category = 'Inter-Account Transfer';
            DROP INDEX IF EXISTS idx_transactions_transfer_group_id;
            ALTER TABLE transactions DROP COLUMN transfer_group_id;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "add editable display_name to statements",
            sql: "ALTER TABLE statements ADD COLUMN display_name TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add transaction grouping (transaction_groups table, transactions.group_id) and per-transaction include_in_totals flag",
            sql: "CREATE TABLE IF NOT EXISTS transaction_groups (
                id TEXT PRIMARY KEY,
                group_type TEXT NOT NULL CHECK (group_type IN ('Product Purchase', 'Home Loan', 'Car Loan', 'Personal Loan', 'Other')),
                label TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            ALTER TABLE transactions ADD COLUMN group_id TEXT;
            CREATE INDEX IF NOT EXISTS idx_transactions_group_id ON transactions (group_id);
            ALTER TABLE transactions ADD COLUMN include_in_totals INTEGER NOT NULL DEFAULT 1;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "add group_suggestion_dismissals table to remember dismissed EMI/loan grouping suggestions",
            sql: "CREATE TABLE IF NOT EXISTS group_suggestion_dismissals (
                id TEXT PRIMARY KEY,
                signature TEXT NOT NULL,
                dismissed_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_group_suggestion_dismissals_signature ON group_suggestion_dismissals (signature);",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .build(),
        )
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:taxai.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
