export const jsonType = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v;

export function contractFrom(term, listing) {
  const inline = term?.outputSchema;
  if (inline?.properties) {
    return {
      kind: 'inline JSON Schema (from live challenge)',
      required: new Set(inline.required ?? Object.keys(inline.properties)),
      keys: Object.entries(inline.properties).map(([k, v]) => [k, v.type ?? 'any']),
    };
  }
  const out = listing?.extensions?.bazaar?.info?.output;
  if (out?.example && typeof out.example === 'object' && !Array.isArray(out.example)) {
    const keys = Object.entries(out.example).map(([k, v]) => [k, jsonType(v)]);
    return { kind: 'registry example object', required: new Set(keys.map(([k]) => k)), keys };
  }
  return { kind: 'none', required: new Set(), keys: [] };
}

export function checkConformance(body, contract) {
  if (contract.kind === 'none') return { verdict: 'UNCHECKABLE', detail: 'seller published no output contract' };
  if (body === null || typeof body !== 'object' || Array.isArray(body))
    return { verdict: 'VIOLATION', detail: `expected a JSON object, got ${jsonType(body)}` };

  const missing = [];
  const wrongType = [];
  for (const [k, t] of contract.keys) {
    if (!(k in body)) { if (contract.required.has(k)) missing.push(k); continue; }
    const got = jsonType(body[k]);
    const ok = t === 'any' || got === t || got === 'null' ||
      (t === 'integer' && got === 'number') || (t === 'number' && got === 'number');
    if (!ok) wrongType.push(`${k}: declared ${t}, got ${got}`);
  }
  const extra = Object.keys(body).filter((k) => !contract.keys.some(([ck]) => ck === k));
  if (missing.length || wrongType.length)
    return {
      verdict: 'VIOLATION',
      detail: [missing.length && `missing required: ${missing.join(', ')}`,
               wrongType.length && `type mismatch: ${wrongType.join('; ')}`].filter(Boolean).join(' | '),
      extra,
    };
  return { verdict: 'CONFORMS', detail: `${contract.keys.length} declared field(s) present, types match`, extra };
}

export function findNested(obj, key, depth = 0) {
  if (obj === null || typeof obj !== 'object' || depth > 4) return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const hit = findNested(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export function nestingReport(parsed, contract, verdict) {
  if (verdict !== 'VIOLATION' || typeof parsed !== 'object' || parsed === null) return null;
  const found = contract.keys.filter(([k]) => findNested(parsed, k) !== undefined).map(([k]) => k);
  if (!found.length) return null;
  return `all declared fields DO exist, nested below the declared level: ${found.join(', ')}. ` +
         `A caller reading them at the declared path gets undefined.`;
}

export function semanticCheck(parsed, expect) {
  if (!expect || typeof parsed !== 'object' || parsed === null) return null;
  const bad = Object.entries(expect)
    .filter(([k, v]) => JSON.stringify(findNested(parsed, k)) !== JSON.stringify(v));
  if (!bad.length) return 'values correct (searched at any depth)';
  return `WRONG VALUE: ${bad.map(([k, v]) =>
    `${k} expected ${JSON.stringify(v)}, found ${JSON.stringify(findNested(parsed, k))}`).join('; ')}`;
}

export const DELIVERY_VERDICTS = new Set(['CONFORMS', 'VIOLATION', 'UNCHECKABLE']);

export function classifyPaidResponse({ httpStatus, parsed, contract, expect }) {
  if (httpStatus === 402)
    return {
      verdict: 'PAYMENT_REJECTED',
      detail: 'paid request was re-challenged with 402; no delivery observed, and this is a client fault until proven otherwise',
      delivered: false,
    };
  if (httpStatus >= 400)
    return {
      verdict: 'NOT_DELIVERED',
      detail: `seller returned HTTP ${httpStatus}; no delivery to check against the contract`,
      delivered: false,
    };

  const conf = typeof parsed === 'string'
    ? { verdict: 'VIOLATION', detail: 'response was not JSON' }
    : checkConformance(parsed, contract);

  return {
    ...conf,
    delivered: true,
    nesting: nestingReport(parsed, contract, conf.verdict),
    semantic: semanticCheck(parsed, expect),
  };
}
