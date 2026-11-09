import postgres from 'postgres';

declare global {
  // eslint-disable-next-line no-var
  var __sql: postgres.Sql | undefined;
}

// En delad anslutningspool, även när Next laddar om moduler i utvecklingsläge.
export const sql =
  globalThis.__sql ??
  postgres(process.env.DATABASE_URL as string, {
    max: 5,
    // Supabase "Transaction pooler" stödjer inte förberedda frågor
    prepare: false,
    onnotice: () => {},
    // Supabase kräver SSL i drift
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : 'require',
  });

if (process.env.NODE_ENV !== 'production') globalThis.__sql = sql;
