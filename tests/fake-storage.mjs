// Låtsas-Supabase Storage för speakerljud.py: signerad uppladdning, publik hämtning med Range,
// borttagning och kopiering. Starta med `node tests/fake-storage.mjs` och kör servern med
// SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=sb_secret_test.
import http from 'node:http';
const KEY = 'sb_secret_test';
const BUCKET = 'avsnittsljud';
const files = new Map();
const tokens = new Map();
const log = [];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,HEAD,PUT,POST,DELETE,OPTIONS' };
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  const send = (code, obj, h = {}) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json', ...h }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  if (req.method === 'OPTIONS') return send(204);
  if (p === '/__log') return send(200, { log, files: [...files.keys()] });
  const signPath = p.match(new RegExp(`^/storage/v1/object/upload/sign/${BUCKET}/(.+)$`));
  if (req.method === 'POST' && signPath) {
    if (req.headers.apikey !== KEY) return send(401, { error: 'no key' });
    const t = Math.random().toString(36).slice(2);
    tokens.set(t, signPath[1]);
    log.push(['sign', signPath[1]]);
    return send(200, { url: `/object/upload/sign/${BUCKET}/${signPath[1]}?token=${t}` });
  }
  if (req.method === 'PUT' && signPath) {
    if (tokens.get(u.searchParams.get('token')) !== signPath[1]) return send(400, { error: 'bad token' });
    const raw = await body(req);
    const fd = await new Request('http://x', { method: 'PUT', headers: { 'content-type': req.headers['content-type'] }, body: raw }).formData();
    const f = fd.get('');
    files.set(signPath[1], { data: Buffer.from(await f.arrayBuffer()), type: f.type || 'application/octet-stream' });
    log.push(['upload', signPath[1], f.type, f.size]);
    return send(200, { Key: `${BUCKET}/${signPath[1]}` });
  }
  const pub = p.match(new RegExp(`^/storage/v1/object/public/${BUCKET}/(.+)$`));
  if ((req.method === 'GET' || req.method === 'HEAD') && pub) {
    const f = files.get(pub[1]);
    if (!f) return send(404, { error: 'not found' });
    const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if (range) {
      const s = +range[1], e = range[2] ? Math.min(+range[2], f.data.length - 1) : f.data.length - 1;
      res.writeHead(206, { ...cors, 'Content-Type': f.type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${f.data.length}`, 'Content-Length': e - s + 1 });
      return res.end(req.method === 'HEAD' ? undefined : f.data.subarray(s, e + 1));
    }
    res.writeHead(200, { ...cors, 'Content-Type': f.type, 'Accept-Ranges': 'bytes', 'Content-Length': f.data.length });
    return res.end(req.method === 'HEAD' ? undefined : f.data);
  }
  if (req.method === 'DELETE' && p === `/storage/v1/object/${BUCKET}`) {
    if (req.headers.apikey !== KEY) return send(401, {});
    const { prefixes } = JSON.parse((await body(req)).toString());
    for (const k of prefixes) files.delete(k);
    log.push(['delete', ...prefixes]);
    return send(200, prefixes.map((name) => ({ name })));
  }
  if (req.method === 'POST' && p === '/storage/v1/object/copy') {
    if (req.headers.apikey !== KEY) return send(401, {});
    const { sourceKey, destinationKey } = JSON.parse((await body(req)).toString());
    const f = files.get(sourceKey);
    if (!f) return send(404, {});
    files.set(destinationKey, f);
    log.push(['copy', sourceKey, destinationKey]);
    return send(200, { Key: destinationKey });
  }
  send(404, { error: 'route', p });
}).listen(54321, () => console.log('Låtsas-Storage på http://localhost:54321'));
