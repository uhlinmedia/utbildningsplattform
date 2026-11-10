import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from './db';

// Kör nya SQL-migreringar automatiskt när servern startar, så att en ny version inte kräver
// ett manuellt steg mot databasen. Ett lås i databasen gör att bara en serverinstans migrerar åt gången.
export async function runMigrations() {
  const dir = join(process.cwd(), 'db', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(4711004)`;
    await tx`create table if not exists schema_migration (name text primary key, run_at timestamptz default now())`;
    const done = new Set((await tx<{ name: string }[]>`select name from schema_migration`).map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
      await tx`insert into schema_migration (name) values (${file})`;
      console.log('Migrering körd:', file);
    }
  });
}
