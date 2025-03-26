# PostgreSQL 到 Supabase 資料遷移工具

[English](README.md)

將 PostgreSQL 資料庫的資料遷移到 Supabase 專案。它會自動處理資料表結構、主鍵、外鍵和序列的遷移。

## 功能特點

- 自動遷移資料表結構（包含主鍵、外鍵和序列）
- 大型資料表的批次處理
- 多種重複資料處理策略
- 遷移日誌和進度報告
- 錯誤重試機制

## 環境需求

- Node.js 14.0 或更高版本
- 現有的 PostgreSQL 資料庫（來源資料）
- 現有的 Supabase 專案（目標）

## 安裝

1. 克隆專案：
```bash
git clone https://github.com/yourusername/psql2supabase.git
cd psql2supabase
```

2. 安裝依賴：
```bash
npm install
```

3. 複製環境變數範本：
```bash
cp .env.example .env
```
或是手動複製`.env`檔案。

4. 編輯 `.env` 檔案，填入你的資料庫連線資訊：
```env
# PostgreSQL 來源資料庫連線資訊
SOURCE_DB_HOST=your-source-db-host
SOURCE_DB_PORT=5432
SOURCE_DB_NAME=your-source-db-name
SOURCE_DB_USER=your-source-db-user
SOURCE_DB_PASSWORD=your-source-db-password

# Supabase 目標資料庫連線資訊
SUPABASE_URL=your-supabase-project-url
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# 連線超時設定（毫秒）
CONNECTION_TIMEOUT=30000

# 重複資料處理策略 (update/skip/error/append)
DUPLICATE_STRATEGY=update

# 大型資料表遷移設定
BATCH_SIZE=1000           # 每批處理的資料筆數
MAX_RETRIES=3            # 失敗重試次數
RETRY_DELAY=5000         # 重試等待時間（毫秒）
BATCH_TIMEOUT=30000      # 批次處理超時時間（毫秒）
```

## 重複資料處理策略

工具提供四種處理重複資料的策略：

1. `update`（預設）：更新現有資料，如果資料不存在則新增
2. `skip`：跳過已存在的資料，只新增不存在的資料
3. `error`：遇到重複資料時立即停止並報錯
4. `append`：忽略主鍵，直接新增所有資料

## 大型資料表遷移設定

對於大型資料表的遷移，工具提供以下設定選項：

- `BATCH_SIZE`：每批處理的資料筆數（預設：1000）
- `MAX_RETRIES`：失敗重試次數（預設：3）
- `RETRY_DELAY`：重試等待時間（預設：5000毫秒）
- `BATCH_TIMEOUT`：批次處理超時時間（預設：30000毫秒）

## 進度保存

工具會在遷移過程中自動保存進度，如果程式中斷，重新執行時可以選擇從上次的進度繼續。進度檔案保存在 `logs` 目錄下。

## 使用方式

1. 確保你已經在 Supabase 中建立了 `exec_sql` 函數（用於執行 SQL 命令），在 Supabase 專案中的 SQL Editor 運行：
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

2. 執行遷移：
```bash
npm start
```

## 日誌

- 錯誤日誌：`logs/error.log`
- 完整日誌：`logs/combined.log`
- 進度檔案：`logs/{table_name}_progress.json`

## 注意事項

1. 確保 Supabase 服務角色金鑰具有足夠的權限
2. 大型資料表遷移時建議適當調整批次大小和超時設定
3. 如果使用 `error` 策略，建議先備份資料

## 授權

MIT 