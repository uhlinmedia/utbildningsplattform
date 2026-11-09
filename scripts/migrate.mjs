// Kör SQL-migreringar i db/migrations som inte redan körts.
import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
await sql`create table if not exists schema_migration (name text primary key, run_at timestamptz default now())`;
const done = new Set((await sql`select name from schema_migration`).map((r) => r.name));
const dir = join(process.cwd(), 'db', 'migrations');
for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(file)) continue;
  await sql.begin(async (tx) => {
    await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
    await tx`insert into schema_migration (name) values (${file})`;
  });
  console.log('Körde', file);
}
await sql.end();
console.log('Databasen är uppdaterad.');
