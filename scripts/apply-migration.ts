/**
 * Apply Migration Script
 * Runs SQL migration against hosted Supabase instance
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function applyMigration() {
  console.log('📦 Applying Notion Schema Alignment Migration...\n');

  const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20250119000000_notion_schema_alignment.sql');
  const sql = readFileSync(migrationPath, 'utf-8');

  // Split into individual statements (rough split, may need adjustment)
  // For safety, we'll run the whole thing at once using rpc if available, 
  // or fall back to direct SQL execution

  try {
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql });
    
    if (error) {
      // If rpc doesn't exist, we need to use the REST API directly
      console.log('Note: exec_sql RPC not available, trying direct approach...');
      throw error;
    }
    
    console.log('✅ Migration applied successfully!');
  } catch (err) {
    // Fall back to using the management API or provide instructions
    console.log('\n⚠️  Cannot apply migration automatically via RPC.');
    console.log('\nPlease apply the migration manually:');
    console.log('1. Go to: https://supabase.com/dashboard/project/zcvwamziybpslpavjljw/sql/new');
    console.log('2. Copy the contents of: supabase/migrations/20250119000000_notion_schema_alignment.sql');
    console.log('3. Paste and click "Run"');
    console.log('\nOr use the Supabase CLI with a linked project.');
    process.exit(1);
  }
}

applyMigration();
