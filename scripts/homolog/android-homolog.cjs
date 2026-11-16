'use strict';
// Isolated VECONI homologation for a physical Android phone over USB.
//
//   node scripts/homolog/android-homolog.cjs start [--reset]   Emulators + seed + local app + adb reverse
//   node scripts/homolog/android-homolog.cjs offline            Phone AND PC lose the backend (app stays loaded)
//   node scripts/homolog/android-homolog.cjs online             Backend comes back
//   node scripts/homolog/android-homolog.cjs usb                (Re)connect a phone plugged in after start
//   node scripts/homolog/android-homolog.cjs reset              Erase the local emulator data
//
// Isolation: Firebase project "demo-veconi-homolog" (demo-* projects never reach Google Cloud),
// all SDKs connected to 127.0.0.1 emulators, production files untouched (rewritten in memory only).
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), net = require('node:net'), os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const PROJECT = 'demo-veconi-homolog';
const APP_PORT = Number(process.env.HOMOLOG_APP_PORT || 5180);
const PORTS = { auth: 9099, firestore: 8080, functions: 5001, storage: 9199 };
const BACKEND = Object.values(PORTS);
// Network gate: the app talks to the emulators through these ports, so "offline"
// can cut the backend for the PC browser and the phone alike (airplane mode does
// not cut USB, and a PC has no airplane mode for localhost).
const GATE = Object.fromEntries(Object.entries(PORTS).map(([name, port]) => [name, port + 10000]));
const GATE_PORTS = Object.values(GATE);
const DATA_DIR = path.join(os.tmpdir(), 'veconi-homolog-data');
const ADB = [process.env.ADB, path.join(process.env.LOCALAPPDATA || '', 'Android/Sdk/platform-tools/adb.exe'),
  path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'), path.join(os.homedir(), 'Android/Sdk/platform-tools/adb'), 'adb']
  .find((candidate) => candidate && (candidate === 'adb' || fs.existsSync(candidate)));

const log = (...args) => console.log('[homolog]', ...args);
const adb = (...args) => spawnSync(ADB, args, { encoding: 'utf8' });
function devices() {
  const out = adb('devices');
  if (out.error) return null;
  return out.stdout.split(/\r?\n/).slice(1).filter((line) => /\tdevice$/.test(line)).map((line) => line.split('\t')[0]);
}
function reverse(ports, remove = false) {
  const list = devices();
  if (!list) { log('adb não encontrado. Instale "Android SDK Platform-Tools" ou defina ADB=<caminho do adb>.'); return false; }
  if (!list.length) { log('Nenhum celular conectado com depuração USB autorizada (adb devices vazio).'); return false; }
  for (const port of ports) {
    const result = remove ? adb('reverse', '--remove', `tcp:${port}`) : adb('reverse', `tcp:${port}`, `tcp:${port}`);
    if (result.status !== 0 && !remove) log(`adb reverse falhou na porta ${port}: ${result.stderr.trim()}`);
  }
  return true;
}
const portOpen = (port) => new Promise((resolve) => {
  const socket = net.connect(port, '127.0.0.1');
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false));
});
async function waitPorts(ports, ms = 180000) {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if ((await Promise.all(ports.map(portOpen))).every(Boolean)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw Error(`Emuladores não responderam nas portas ${ports.join(', ')}.`);
}

// Functions params/secrets for the emulator only: obviously fake values, files are gitignored.
function ensureEmulatorParams() {
  const env = path.join(ROOT, 'functions', `.env.${PROJECT}`), secret = path.join(ROOT, 'functions', '.secret.local');
  if (!fs.existsSync(env)) fs.writeFileSync(env, ['MERCADO_PAGO_ENV=sandbox', 'MERCADO_PAGO_PUBLIC_KEY=homolog-fake',
    `ADI_FESTA_APP_URL=http://localhost:${APP_PORT}`, 'MERCADO_PAGO_WEBHOOK_URL=http://127.0.0.1:9/disabled', ''].join('\n'));
  if (!fs.existsSync(secret)) fs.writeFileSync(secret, ['MERCADO_PAGO_ACCESS_TOKEN=homolog-fake', 'MERCADO_PAGO_ACCESS_TOKEN_TEST=homolog-fake',
    'MERCADO_PAGO_WEBHOOK_SECRET=homolog-fake', ''].join('\n'));
}

// In-memory rewrites of the served copy. Nothing on disk changes.
const host = '127.0.0.1';
function rewrite(pathname, source) {
  if (pathname === '/js/firebase/firebase-config.js') {
    source = source
      .replace(/apiKey:'[^']*'/, "apiKey:'demo-homolog-key'")
      .replace(/authDomain:'[^']*'/, `authDomain:'${PROJECT}.firebaseapp.com'`)
      .replace(/projectId:'[^']*'/, `projectId:'${PROJECT}'`)
      .replace(/storageBucket:'[^']*'/, `storageBucket:'${PROJECT}.appspot.com'`)
      .replace(/if\(firebaseConfig\.projectId!==PROJECT_ID\)throw [^;]*;/, '')
      .replace('getAuth, setPersistence', 'connectAuthEmulator, getAuth, setPersistence')
      .replace('initializeFirestore, memoryLocalCache', 'connectFirestoreEmulator, initializeFirestore, memoryLocalCache')
      .replace('getFunctions, httpsCallable', 'connectFunctionsEmulator, getFunctions, httpsCallable')
      .replace('export const auth=getAuth(app);', `export const auth=getAuth(app);connectAuthEmulator(auth,'http://${host}:${GATE.auth}',{disableWarnings:true});`)
      .replace('export const db=initializeFirestore(app,{localCache:memoryLocalCache()});', `export const db=initializeFirestore(app,{localCache:memoryLocalCache()});connectFirestoreEmulator(db,'${host}',${GATE.firestore});`)
      .replace("export const functions=getFunctions(app,'southamerica-east1');", `export const functions=getFunctions(app,'southamerica-east1');connectFunctionsEmulator(functions,'${host}',${GATE.functions});`);
    for (const marker of ['connectAuthEmulator(auth', 'connectFirestoreEmulator(db', 'connectFunctionsEmulator(functions', `projectId:'${PROJECT}'`])
      if (!source.includes(marker)) throw Error(`firebase-config.js mudou: não foi possível aplicar "${marker}". Atualize o script.`);
    return source;
  }
  if (pathname === '/js/firebase/workspace-storage.js')
    return `${source}\nconst __homologStorage=new WeakSet();export const getStorage=(...args)=>{const storage=sdk.getStorage(...args);if(!__homologStorage.has(storage)){sdk.connectStorageEmulator(storage,'${host}',${GATE.storage});__homologStorage.add(storage);}return storage;};\n`;
  if (pathname === '/js/firebase/google-auth.js')
    return source.replace(/https:\/\/[a-z0-9-]+\.cloudfunctions\.net/g, 'http://127.0.0.1:9/homolog-google-disabled');
  if (pathname === '/js/firebase/sync.js') return source; // PROJECT_ID constant stays; only the SDK project changes.
  return source;
}

const gate = { online: true, sockets: new Set() };
function startGate() {
  return Promise.all(Object.keys(PORTS).map((name) => new Promise((resolve, reject) => {
    const server = net.createServer((client) => {
      if (!gate.online) return client.destroy();
      const upstream = net.connect(PORTS[name], '127.0.0.1');
      for (const socket of [client, upstream]) { gate.sockets.add(socket); socket.on('close', () => gate.sockets.delete(socket)); socket.on('error', () => {}); }
      client.pipe(upstream).pipe(client);
      client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
    });
    server.once('error', reject);
    server.listen(GATE[name], '127.0.0.1', () => resolve(server));
  })));
}
function setNetwork(online) {
  gate.online = online;
  if (!online) for (const socket of gate.sockets) socket.destroy();
  log(online ? 'Rede da homologação: ONLINE (backend acessível).' : 'Rede da homologação: OFFLINE (backend inacessível para o PC e o celular; o app continua aberto).');
}
function serve() {
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain' };
  const textual = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (req.method === 'POST' && /^\/__homolog\/network\/(online|offline)$/.test(pathname) && req.socket.remoteAddress?.replace('::ffff:', '') === '127.0.0.1') {
      setNetwork(pathname.endsWith('/online'));
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ online: gate.online }));
    }
    if (pathname === '/__homolog/network') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ online: gate.online }));
    const file = path.resolve(ROOT, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(ROOT + path.sep) || /[\\/](functions[\\/](\.env|\.secret)|node_modules|\.git)/.test(file) ||
        !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end('Not found');
    const ext = path.extname(file);
    res.setHeader('Content-Type', (mime[ext] || 'application/octet-stream') + (textual.has(ext) ? '; charset=utf-8' : ''));
    res.setHeader('Cache-Control', 'no-cache');
    if (!textual.has(ext)) return fs.createReadStream(file).pipe(res);
    try { res.end(rewrite(pathname, fs.readFileSync(file, 'utf8'))); }
    catch (error) { console.error(error.message); res.writeHead(500).end(error.message); }
  });
  return new Promise((resolve) => server.listen(APP_PORT, '127.0.0.1', () => resolve(server)));
}

async function start(reset) {
  if (reset) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const firstRun = !fs.existsSync(path.join(DATA_DIR, 'firebase-export-metadata.json'));
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const port of [...BACKEND, ...GATE_PORTS, APP_PORT]) if (await portOpen(port)) throw Error(`A porta ${port} já está em uso. Feche o outro processo e tente de novo.`);
  ensureEmulatorParams();
  const args = ['emulators:start', '--only', 'auth,firestore,functions,storage', '--project', PROJECT, '--export-on-exit', DATA_DIR,
    ...(firstRun ? [] : ['--import', DATA_DIR])];
  log('Iniciando emuladores (projeto isolado ' + PROJECT + ')...');
  const emulators = spawn(process.platform === 'win32' ? 'firebase.cmd' : 'firebase', args, { cwd: ROOT, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GCLOUD_PROJECT: PROJECT } });
  const emulatorLog = fs.createWriteStream(path.join(os.tmpdir(), 'veconi-homolog-emulators.log'));
  emulators.stdout.pipe(emulatorLog); emulators.stderr.pipe(emulatorLog);
  emulators.on('exit', (code) => { log(`Emuladores encerrados (código ${code}).`); process.exit(code || 0); });
  await waitPorts(BACKEND);
  Object.assign(process.env, { FIRESTORE_EMULATOR_HOST: `127.0.0.1:${PORTS.firestore}`, FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${PORTS.auth}`,
    FIREBASE_STORAGE_EMULATOR_HOST: `127.0.0.1:${PORTS.storage}`, GCLOUD_PROJECT: PROJECT });
  if (firstRun) {
    const admin = require(path.join(ROOT, 'functions/node_modules/firebase-admin'));
    admin.initializeApp({ projectId: PROJECT });
    const result = await require('./seed.cjs').seed(admin);
    log(`Dados fictícios criados: ${result.documents} documentos. Contas de teste: ${Object.values(result.users).join(', ')}`);
    log('A senha de teste está em scripts/homolog/seed.cjs (PASSWORD).');
  } else log('Dados anteriores restaurados de ' + DATA_DIR + ' (use --reset para recomeçar).');
  await startGate();
  await serve();
  const usb = reverse([APP_PORT, ...GATE_PORTS]);
  log(`Aplicativo local: http://localhost:${APP_PORT}/  (somente emuladores)`);
  log(usb ? `No celular, abra no Chrome: http://localhost:${APP_PORT}/` : 'Conecte o celular por USB e rode: node scripts/homolog/android-homolog.cjs usb');
  log('Para simular perda de conexão: node scripts/homolog/android-homolog.cjs offline   (e "online" para voltar).');
  log('Para encerrar e salvar os dados: Ctrl+C.');
  const stop = () => { reverse([APP_PORT, ...GATE_PORTS], true); emulators.kill('SIGINT'); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

const [command = 'start', ...flags] = process.argv.slice(2);
if (command === 'start') start(flags.includes('--reset')).catch((error) => { console.error('[homolog] ' + error.message); process.exit(1); });
else if (command === 'offline' || command === 'online') {
  const request = http.request({ host: '127.0.0.1', port: APP_PORT, method: 'POST', path: '/__homolog/network/' + command }, (res) => {
    let body = ''; res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => log(JSON.parse(body || '{}').online ? 'Backend ONLINE. Abra Sincronização ou aguarde o envio automático.' : 'Backend OFFLINE para o PC e o celular. O app continua aberto; as vendas ficam na fila local.'));
  });
  request.on('error', () => { log('A homologação não está em execução (inicie com "start").'); process.exitCode = 1; });
  request.end();
}
else if (command === 'usb') { if (reverse([APP_PORT, ...GATE_PORTS])) log(`Celular conectado. Abra no Chrome do celular: http://localhost:${APP_PORT}/`); }
else if (command === 'reset') { fs.rmSync(DATA_DIR, { recursive: true, force: true }); log('Dados locais apagados: ' + DATA_DIR); }
else { console.log('Uso: node scripts/homolog/android-homolog.cjs start [--reset] | usb | offline | online | reset'); process.exit(1); }
