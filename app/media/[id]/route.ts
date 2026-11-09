import { sql } from '@/lib/db';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Hittades inte', { status: 404 });
  const [m] = await sql<{ mime: string; data: Buffer }[]>`select mime, data from media where id = ${id}`;
  if (!m) return new Response('Hittades inte', { status: 404 });
  return new Response(new Uint8Array(m.data), {
    headers: {
      'Content-Type': m.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
