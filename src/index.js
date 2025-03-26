require('dotenv').config();
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const winston = require('winston');
const cliProgress = require('cli-progress');
const fs = require('fs').promises;
const path = require('path');

// 設定日誌
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// 重複資料處理策略
const DUPLICATE_STRATEGIES = {
  UPDATE: 'update',    // 更新現有資料
  SKIP: 'skip',        // 跳過重複資料
  ERROR: 'error',      // 遇到重複資料時報錯
  APPEND: 'append'     // 附加新資料（忽略主鍵）
};

// 從環境變數獲取設定
const duplicateStrategy = process.env.DUPLICATE_STRATEGY || DUPLICATE_STRATEGIES.UPDATE;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 1000;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY) || 5000; // 5秒
const BATCH_TIMEOUT = parseInt(process.env.BATCH_TIMEOUT) || 30000; // 30秒

// 建立 PostgreSQL 連線
const sourcePool = new Pool({
  host: process.env.SOURCE_DB_HOST,
  port: process.env.SOURCE_DB_PORT,
  database: process.env.SOURCE_DB_NAME,
  user: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  connectionTimeoutMillis: parseInt(process.env.CONNECTION_TIMEOUT) || 30000
});

// 建立 Supabase 連線
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 延遲函數
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// 重試函數
async function withRetry(operation, maxRetries = MAX_RETRIES) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        console.log(`操作失敗，${attempt}/${maxRetries} 次嘗試，等待 ${RETRY_DELAY/1000} 秒後重試...`);
        await delay(RETRY_DELAY);
      }
    }
  }
  
  throw lastError;
}

// 保存進度
async function saveProgress(tableName, currentIndex, totalCount) {
  const progress = {
    tableName,
    currentIndex,
    totalCount,
    timestamp: new Date().toISOString()
  };
  
  await fs.writeFile(
    path.join('logs', `${tableName}_progress.json`),
    JSON.stringify(progress, null, 2)
  );
}

// 讀取進度
async function loadProgress(tableName) {
  try {
    const data = await fs.readFile(
      path.join('logs', `${tableName}_progress.json`),
      'utf8'
    );
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

// 測試連線
async function testConnections() {
  console.log('測試資料庫連線中...');
  
  try {
    // 測試 PostgreSQL 連線
    const pgClient = await sourcePool.connect();
    await pgClient.query('SELECT NOW()');
    pgClient.release();
    
    // 測試 Supabase 連線
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    
    console.log('✓ 資料庫連線測試成功！');
    return true;
  } catch (error) {
    console.log('✗ 資料庫連線測試失敗！');
    logger.error('連線測試失敗:', error);
    return false;
  }
}

// 獲取所有資料表
async function getTables() {
  console.log('獲取資料表清單中...');
  
  try {
    const result = await sourcePool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `);
    
    console.log(`✓ 成功獲取 ${result.rows.length} 個資料表`);
    return result.rows.map(row => row.table_name);
  } catch (error) {
    console.log('✗ 獲取資料表清單失敗！');
    logger.error('獲取資料表失敗:', error);
    throw error;
  }
}

// 獲取資料表結構
async function getTableStructure(tableName) {
  // 獲取欄位資訊
  const columnsResult = await sourcePool.query(`
    SELECT 
      column_name,
      data_type,
      is_nullable,
      column_default,
      character_maximum_length
    FROM information_schema.columns
    WHERE table_name = $1
    ORDER BY ordinal_position
  `, [tableName]);

  // 獲取主鍵資訊
  const primaryKeyResult = await sourcePool.query(`
    SELECT c.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage AS ccu USING (constraint_schema, constraint_name)
    JOIN information_schema.columns AS c ON c.table_schema = tc.constraint_schema
      AND tc.table_name = c.table_name AND ccu.column_name = c.column_name
    WHERE tc.table_name = $1 AND tc.constraint_type = 'PRIMARY KEY'
  `, [tableName]);

  // 獲取外鍵資訊
  const foreignKeyResult = await sourcePool.query(`
    SELECT
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = $1
  `, [tableName]);

  // 獲取序列資訊
  const sequenceResult = await sourcePool.query(`
    SELECT 
      column_name,
      column_default
    FROM information_schema.columns
    WHERE table_name = $1
    AND column_default LIKE 'nextval%'
  `, [tableName]);

  return {
    columns: columnsResult.rows,
    primaryKeys: primaryKeyResult.rows.map(row => row.column_name),
    foreignKeys: foreignKeyResult.rows,
    sequences: sequenceResult.rows
  };
}

// 建立資料表
async function createTable(tableName, structure) {
  const { columns, primaryKeys, foreignKeys, sequences } = structure;
  
  // 建立欄位定義
  const columnDefinitions = columns.map(col => {
    let def = `"${col.column_name}" ${col.data_type}`;
    
    // 處理字串長度
    if (col.character_maximum_length) {
      def = def.replace(/character varying/, `varchar(${col.character_maximum_length})`);
    }
    
    // 處理 NOT NULL
    if (col.is_nullable === 'NO') {
      def += ' NOT NULL';
    }
    
    // 處理預設值（排除序列）
    if (col.column_default && !col.column_default.includes('nextval')) {
      def += ` DEFAULT ${col.column_default}`;
    }
    
    return def;
  });

  // 添加主鍵
  if (primaryKeys.length > 0) {
    columnDefinitions.push(`PRIMARY KEY (${primaryKeys.map(pk => `"${pk}"`).join(', ')})`);
  }

  // 添加外鍵
  foreignKeys.forEach(fk => {
    columnDefinitions.push(
      `FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_name}" ("${fk.foreign_column_name}")`
    );
  });

  // 組合完整的 CREATE TABLE 語句
  const createTableSQL = `
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      ${columnDefinitions.join(',\n      ')}
    )
  `;

  // 在 Supabase 中執行 SQL
  const { error: tableError } = await supabase.rpc('exec_sql', {
    sql: createTableSQL
  });

  if (tableError) {
    console.log('建立資料表失敗:', tableError);
    throw tableError;
  }

  // 處理序列
  for (const seq of sequences) {
    const sequenceName = `${tableName}_${seq.column_name}_seq`;
    const createSequenceSQL = `
      CREATE SEQUENCE IF NOT EXISTS "${sequenceName}"
      START WITH 1
      INCREMENT BY 1
      NO MINVALUE
      NO MAXVALUE
      CACHE 1;
      
      ALTER TABLE "${tableName}"
      ALTER COLUMN "${seq.column_name}"
      SET DEFAULT nextval('"${sequenceName}"');
    `;

    const { error: seqError } = await supabase.rpc('exec_sql', {
      sql: createSequenceSQL
    });

    if (seqError) {
      console.log('建立序列失敗:', seqError);
      throw seqError;
    }
  }
}

// 檢查資料表是否存在
async function checkTableExists(tableName) {
  try {
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .limit(1);
    
    if (error) {
      if (error.code === '42P01') { // 資料表不存在
        return false;
      }
      throw error;
    }
    
    return true;
  } catch (error) {
    if (error.code === '42P01') {
      return false;
    }
    throw error;
  }
}

// 遷移單個資料表
async function migrateTable(tableName) {
  console.log(`\n開始遷移資料表 ${tableName}...`);
  
  try {
    // 檢查資料表是否存在
    const exists = await checkTableExists(tableName);
    if (!exists) {
      console.log(`資料表 ${tableName} 不存在，正在建立...`);
      const structure = await getTableStructure(tableName);
      await createTable(tableName, structure);
      console.log(`✓ 資料表 ${tableName} 建立完成`);
    }
    
    // 獲取資料總數
    const countResult = await sourcePool.query(`SELECT COUNT(*) FROM ${tableName}`);
    const totalCount = parseInt(countResult.rows[0].count);
    
    // 讀取上次的進度
    const progress = await loadProgress(tableName);
    let startIndex = 0;
    if (progress && progress.tableName === tableName) {
      console.log(`發現上次的進度：${progress.currentIndex}/${progress.totalCount}`);
      const resume = await new Promise(resolve => {
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });
        readline.question('是否要從上次的進度繼續？(y/n) ', answer => {
          readline.close();
          resolve(answer.toLowerCase() === 'y');
        });
      });
      
      if (resume) {
        startIndex = progress.currentIndex;
      }
    }
    
    // 建立進度條
    const progressBar = new cliProgress.SingleBar({
      format: '{bar} {percentage}% | {value}/{total} | {table}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    }, cliProgress.Presets.shades_classic);
    
    progressBar.start(totalCount, startIndex, { table: tableName });
    
    let skippedCount = 0;
    let updatedCount = 0;
    let insertedCount = 0;
    
    // 分批處理資料
    for (let i = startIndex; i < totalCount; i += BATCH_SIZE) {
      const batch = await sourcePool.query(
        `SELECT * FROM ${tableName} ORDER BY id LIMIT $1 OFFSET $2`,
        [BATCH_SIZE, i]
      );
      
      try {
        // 使用 Promise.race 來實現超時控制
        await Promise.race([
          (async () => {
            switch (duplicateStrategy) {
              case DUPLICATE_STRATEGIES.UPDATE:
                const { error: updateError } = await withRetry(() =>
                  supabase.from(tableName).upsert(batch.rows, { onConflict: 'id' })
                );
                if (updateError) throw updateError;
                updatedCount += batch.rows.length;
                break;
                
              case DUPLICATE_STRATEGIES.SKIP:
                for (const row of batch.rows) {
                  const { data: existing } = await withRetry(() =>
                    supabase.from(tableName).select('id').eq('id', row.id).single()
                  );
                  
                  if (!existing) {
                    const { error: insertError } = await withRetry(() =>
                      supabase.from(tableName).insert(row)
                    );
                    if (insertError) throw insertError;
                    insertedCount++;
                  } else {
                    skippedCount++;
                  }
                }
                break;
                
              case DUPLICATE_STRATEGIES.ERROR:
                for (const row of batch.rows) {
                  const { data: existing } = await withRetry(() =>
                    supabase.from(tableName).select('id').eq('id', row.id).single()
                  );
                  
                  if (existing) {
                    throw new Error(`發現重複資料：ID ${row.id}`);
                  }
                  
                  const { error: insertError } = await withRetry(() =>
                    supabase.from(tableName).insert(row)
                  );
                  if (insertError) throw insertError;
                  insertedCount++;
                }
                break;
                
              case DUPLICATE_STRATEGIES.APPEND:
                const { error: appendError } = await withRetry(() =>
                  supabase.from(tableName).insert(batch.rows)
                );
                if (appendError) throw appendError;
                insertedCount += batch.rows.length;
                break;
            }
          })(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('批次處理超時')), BATCH_TIMEOUT)
          )
        ]);
        
        // 更新進度
        progressBar.update(Math.min(i + BATCH_SIZE, totalCount));
        
        // 每處理完一個批次就保存進度
        await saveProgress(tableName, i + BATCH_SIZE, totalCount);
        
      } catch (error) {
        console.log(`\n✗ 批次處理失敗 (${i} 到 ${i + BATCH_SIZE}):`, error);
        throw error;
      }
    }
    
    progressBar.stop();
    console.log(`✓ 資料表 ${tableName} 遷移完成！`);
    console.log(`  更新: ${updatedCount} 筆`);
    console.log(`  新增: ${insertedCount} 筆`);
    console.log(`  跳過: ${skippedCount} 筆`);
    
    // 刪除進度檔案
    try {
      await fs.unlink(path.join('logs', `${tableName}_progress.json`));
    } catch (error) {
      // 忽略檔案不存在的錯誤
    }
    
    logger.info(`資料表 ${tableName} 遷移完成，共 ${totalCount} 筆資料`, {
      updated: updatedCount,
      inserted: insertedCount,
      skipped: skippedCount
    });
  } catch (error) {
    console.log(`\n✗ 資料表 ${tableName} 遷移失敗！`);
    logger.error(`遷移資料表 ${tableName} 失敗:`, error);
    throw error;
  }
}

// 主程式
async function main() {
  try {
    // 測試連線
    if (!await testConnections()) {
      throw new Error('資料庫連線測試失敗');
    }
    
    // 獲取資料表清單
    const tables = await getTables();
    
    // 遷移每個資料表
    for (const table of tables) {
      await migrateTable(table);
    }
    
    console.log('\n✓ 所有資料表遷移完成！');
    logger.info('所有資料表遷移完成！');
  } catch (error) {
    console.log('\n✗ 遷移過程發生錯誤！');
    logger.error('遷移過程發生錯誤:', error);
    process.exit(1);
  } finally {
    await sourcePool.end();
  }
}

// 執行主程式
main(); 