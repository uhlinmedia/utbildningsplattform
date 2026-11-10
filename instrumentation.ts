// Körs en gång när en serverinstans startar: kör eventuella nya databasmigreringar.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('./lib/migrate');
    try {
      if (process.env.DATABASE_URL) await runMigrations();
    } catch (e) {
      console.error('Databasmigrering misslyckades', e);
    }
  }
}
