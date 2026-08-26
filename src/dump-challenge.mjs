const url = process.argv[2];
const method = process.argv[3] ?? 'POST';
const body = process.argv[4] ?? '{"n":97}';

const init = { method, headers: { 'User-Agent': 'delivered-probe/0.1 (research)' } };
if (method !== 'GET') {
  init.headers['Content-Type'] = 'application/json';
  init.body = body;
}
const r = await fetch(url, init);
console.log('status:', r.status);
const j = await r.json();
console.log(JSON.stringify(j, null, 1));
