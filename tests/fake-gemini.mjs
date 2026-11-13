// Låtsas-Gemini (Interactions API) för ai-rost.py: svarar med en WAV-ton (24 kHz, 16 bitar, mono),
// 2 sekunder per anrop. Starta med `node tests/fake-gemini.mjs` och kör servern med
// GEMINI_API_BASE=http://localhost:54322 GEMINI_API_KEY=test-nyckel.
// Text som innehåller FEL429 ger svaret 429 (slut på kvot), FEL401 ger 401 (fel nyckel).
import http from 'node:http';
const KEY = 'test-nyckel';
const log = [];

function wav(seconds, hz) {
  const rate = 24000, n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * hz * i) / rate)), 44 + i * 2);
  return buf;
}

http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/__log') return send(200, { log });
  if (req.method !== 'POST' || req.url !== '/v1beta/interactions') return send(404, { error: 'route' });
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  const content = body.input?.[0]?.content?.[0] ?? {};
  log.push({ key: req.headers['x-goog-api-key'], model: body.model, voice: body.generation_config?.speech_config?.[0]?.voice,
    style: content.annotations?.[0]?.style, chars: (content.text ?? '').length, format: body.response_format });
  if (req.headers['x-goog-api-key'] !== KEY || (content.text ?? '').includes('FEL401')) return send(401, { error: { message: 'API key not valid' } });
  if ((content.text ?? '').includes('FEL429')) return send(429, { error: { message: 'Resource exhausted' } });
  send(200, {
    id: 'interaction-test',
    steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: wav(2, 330).toString('base64') }] }],
  });
}).listen(54322, () => console.log('Låtsas-Gemini på http://localhost:54322'));
