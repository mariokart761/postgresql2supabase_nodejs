# PostgreSQL to Supabase Migration Tool

[中文說明](README.zh-TW.md)

A tool for migrating data from PostgreSQL database to Supabase project. It automatically handles table structures, primary keys, foreign keys, and sequences.

## Features

- Automatic table structure migration (including primary keys, foreign keys, and sequences)
- Batch processing for large tables
- Multiple duplicate data handling strategies
- Migration logs and progress reports
- Error retry mechanism

## Requirements

- Node.js 14.0 or above
- Existing PostgreSQL Database (Source Data)
- Existing Supabase project (Target)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/psql2supabase.git
cd psql2supabase
```

2. Install dependencies:
```bash
npm install
```

3. Copy the environment variables template:
```bash
cp .env.example .env
```
Or manually create the `.env` file.

4. Edit the `.env` file with your database connection information:
```env
# PostgreSQL Source Database Connection
SOURCE_DB_HOST=your-source-db-host
SOURCE_DB_PORT=5432
SOURCE_DB_NAME=your-source-db-name
SOURCE_DB_USER=your-source-db-user
SOURCE_DB_PASSWORD=your-source-db-password

# Supabase Target Database Connection
SUPABASE_URL=your-supabase-project-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Connection Timeout (milliseconds)
CONNECTION_TIMEOUT=30000

# Duplicate Data Handling Strategy (update/skip/error/append)
DUPLICATE_STRATEGY=update

# Large Table Migration Settings
BATCH_SIZE=1000           # Number of records per batch
MAX_RETRIES=3            # Maximum number of retries
RETRY_DELAY=5000         # Retry delay (milliseconds)
BATCH_TIMEOUT=30000      # Batch processing timeout (milliseconds)
```

## Duplicate Data Handling Strategies

The tool provides four strategies for handling duplicate data:

1. `update` (default): Update existing records or insert new ones
2. `skip`: Skip existing records and only insert new ones
3. `error`: Stop and raise an error when duplicates are found
4. `append`: Ignore primary keys and insert all records

## Large Table Migration Settings

For large table migrations, the tool provides the following configuration options:

- `BATCH_SIZE`: Number of records per batch (default: 1000)
- `MAX_RETRIES`: Number of retry attempts (default: 3)
- `RETRY_DELAY`: Delay between retries (default: 5000ms)
- `BATCH_TIMEOUT`: Timeout for batch processing (default: 30000ms)

## Progress Saving

The tool automatically saves migration progress. If the process is interrupted, you can resume from the last saved point when restarting. Progress files are stored in the `logs` directory.

## Usage

1. Ensure you have created the `exec_sql` function in your Supabase project. Run this SQL in the Supabase SQL Editor:
```sql
create or replace function exec_sql(sql text)
returns void
language plpgsql
security definer
as $$
begin
  execute sql;
end;
$$;
```

2. Run the migration:
```bash
npm start
```

## Logs

- Error logs: `logs/error.log`
- Complete logs: `logs/combined.log`
- Progress files: `logs/{table_name}_progress.json`

## Important Notes

1. Ensure the Supabase service role key has sufficient permissions
2. Adjust batch size and timeout settings appropriately for large table migrations
3. Backup your data before using the `error` strategy

## License

MIT
