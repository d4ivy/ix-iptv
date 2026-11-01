import { createServer } from 'node:http';

/**
 * Servidor HTTP local para las pruebas: `routes` mapea una ruta a `(req, res) => void`. Devuelve `{ base, close, hits }`.
 * `close` destruye los sockets abiertos (Node 16 no tiene `closeAllConnections` y su `node:test` no tiene `t.after`: las pruebas
 * cierran con `try/finally` mediante `withServer`).
 */
export async function startServer(routes) {
  const hits = [];
  const sockets = new Set();
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits.push({ path, headers: req.headers, at: Date.now() });
    const route = routes[path];
    if (route === undefined) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no');
      return;
    }
    route(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    hits,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Arranca el servidor, ejecuta `fn(server)` y lo cierra siempre. */
export async function withServer(routes, fn) {
  const server = await startServer(routes);
  try {
    return await fn(server);
  } finally {
    await server.close();
  }
}

/** Crea una carpeta temporal, ejecuta `fn(dir)` y la borra siempre. */
export async function withTempDir(fn) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'iptv-validated-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const text = (body, type = 'application/vnd.apple.mpegurl', status = 200) => (_req, res) => {
  res.writeHead(status, { 'Content-Type': type });
  res.end(body);
};

export const MEDIA = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n#EXTINF:6.0,\nseg2.ts\n';
export const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\nmedia.m3u8\n';

/** Una API mínima de iptv-org con los casos que el cruce tiene que tratar. */
export function fixtureApi(urlFor = (name) => `https://cdn.example.com/${name}.m3u8`) {
  return {
    streams: [
      { channel: 'NorteTV.mx', feed: null, title: 'Norte', url: urlFor('norte-720'), quality: '720p', labels: [], user_agent: null, referrer: null },
      { channel: 'NorteTV.mx', feed: null, title: 'Norte', url: urlFor('norte-1080'), quality: '1080p', labels: ['Not 24/7'], user_agent: null, referrer: null },
      { channel: 'NorteTV.mx', feed: null, title: 'Norte', url: urlFor('norte-1080b'), quality: '1080p', labels: [], user_agent: null, referrer: null },
      { channel: 'NorteTV.mx', feed: null, title: 'Norte (repetida)', url: urlFor('norte-720'), quality: '720p', labels: [], user_agent: null, referrer: null },
      { channel: 'Vida.mx', feed: 'SD', title: 'Vida', url: urlFor('vida'), quality: null, labels: [], user_agent: '#EXTVLCOPT:http-user-agent=Mozilla/5.0 CrKey/1.44', referrer: 'No response' },
      { channel: 'HBO.us', feed: 'East', title: 'HBO East', url: urlFor('hbo-east'), quality: '1080p', labels: [], user_agent: null, referrer: 'https://hbo.example.com/' },
      { channel: 'HBO.us', feed: 'Pacific', title: 'HBO ?', url: urlFor('hbo-unknown-feed'), quality: '720p', labels: [], user_agent: null, referrer: null },
      { channel: null, feed: null, title: 'Sin canal', url: urlFor('orphan'), quality: null, labels: [], user_agent: null, referrer: null },
      { channel: 'NoExiste.xx', feed: null, title: 'Desconocido', url: urlFor('unknown'), quality: null, labels: [], user_agent: null, referrer: null },
      { channel: 'Bloqueado.us', feed: null, title: 'Bloqueado', url: urlFor('blocked'), quality: null, labels: [], user_agent: null, referrer: null },
      { channel: 'Adulto.us', feed: null, title: 'NSFW', url: urlFor('nsfw'), quality: null, labels: [], user_agent: null, referrer: null },
      { channel: 'Cerrado.mx', feed: null, title: 'Cerrado', url: urlFor('closed'), quality: null, labels: [], user_agent: null, referrer: null },
      { channel: 'NorteTV.mx', feed: null, title: 'RTMP', url: 'rtmp://cdn.example.com/live', quality: null, labels: [], user_agent: null, referrer: null },
      { channel: 'NorteTV.mx', feed: null, title: 'Local', url: 'http://127.0.0.1/live.m3u8', quality: null, labels: [], user_agent: null, referrer: null },
    ],
    channels: [
      { id: 'NorteTV.mx', name: 'Norte TV', alt_names: ['Norte Televisión'], country: 'MX', categories: ['general'], is_nsfw: false, closed: null },
      { id: 'Vida.mx', name: 'Vida', alt_names: [], country: 'MX', categories: ['religious'], is_nsfw: false, closed: null },
      { id: 'HBO.us', name: 'HBO', alt_names: [], country: 'US', categories: ['movies'], is_nsfw: false, closed: null },
      { id: 'Bloqueado.us', name: 'Bloqueado', alt_names: [], country: 'US', categories: [], is_nsfw: false, closed: null },
      { id: 'Adulto.us', name: 'Adulto', alt_names: [], country: 'US', categories: ['xxx'], is_nsfw: true, closed: null },
      { id: 'Cerrado.mx', name: 'Cerrado', alt_names: [], country: 'MX', categories: [], is_nsfw: false, closed: '2020-01-01' },
    ],
    feeds: [
      { channel: 'NorteTV.mx', id: 'SD', name: 'SD', is_main: true, languages: ['spa'] },
      { channel: 'Vida.mx', id: 'SD', name: 'SD', is_main: true, languages: ['spa'] },
      { channel: 'HBO.us', id: 'East', name: 'East', is_main: true, languages: ['eng'] },
      { channel: 'HBO.us', id: 'West', name: 'West', is_main: false, languages: ['eng'] },
    ],
    logos: [
      { channel: 'NorteTV.mx', feed: null, in_use: false, tags: [], width: 1000, height: 500, format: 'PNG', url: 'https://img.example.com/norte-old.png' },
      { channel: 'NorteTV.mx', feed: null, in_use: true, tags: [], width: 512, height: 256, format: 'PNG', url: 'https://img.example.com/norte.png' },
      { channel: 'HBO.us', feed: 'East', in_use: true, tags: [], width: 300, height: 300, format: 'SVG', url: 'https://img.example.com/hbo-east.svg' },
      { channel: 'HBO.us', feed: null, in_use: true, tags: [], width: 400, height: 400, format: 'PNG', url: 'https://img.example.com/hbo.png' },
    ],
    blocklist: [{ channel: 'Bloqueado.us', reason: 'dmca', ref: 'https://example.com' }],
    countries: [
      { name: 'Mexico', code: 'MX', languages: ['spa'], flag: '🇲🇽' },
      { name: 'United States', code: 'US', languages: ['eng'], flag: '🇺🇸' },
      { name: 'United Kingdom', code: 'UK', languages: ['eng'], flag: '🇬🇧' },
    ],
    categories: [{ id: 'general', name: 'General' }],
  };
}
