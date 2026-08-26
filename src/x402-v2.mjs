import { toHex } from 'viem';

const NAMED_TO_CHAIN_ID = { base: 8453, 'base-sepolia': 84532 };

const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

export function chainIdOf(network) {
  const caip = /^eip155:(\d+)$/.exec(String(network));
  if (caip) return Number(caip[1]);
  const named = NAMED_TO_CHAIN_ID[network];
  if (named) return named;
  throw new Error(`unsupported network identifier: ${network}`);
}

export const termAmount = (term) => String(term.amount ?? term.maxAmountRequired ?? '');

export function createNonce() {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export function buildAuthorization(from, term, now) {
  const value = termAmount(term);
  if (!/^\d+$/.test(value)) throw new Error(`term carries no parseable amount: ${JSON.stringify(term)}`);
  return {
    from,
    to: term.payTo,
    value,
    validAfter: String(now - 600),
    validBefore: String(now + Number(term.maxTimeoutSeconds ?? 300)),
    nonce: createNonce(),
  };
}

export function typedData(authorization, term) {
  return {
    types: AUTHORIZATION_TYPES,
    domain: {
      name: term.extra?.name ?? 'USD Coin',
      version: term.extra?.version ?? '2',
      chainId: chainIdOf(term.network),
      verifyingContract: term.asset,
    },
    primaryType: 'TransferWithAuthorization',
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  };
}

export function envelope({ version, term, signature, authorization, challenge, url }) {
  if (version === 2) {
    return {
      x402Version: 2,
      resource: {
        url: challenge?.resource?.url ?? url,
        description: challenge?.resource?.description ?? '',
        mimeType: challenge?.resource?.mimeType ?? 'application/json',
      },
      accepted: {
        scheme: term.scheme ?? 'exact',
        network: term.network,
        amount: termAmount(term),
        asset: term.asset,
        payTo: term.payTo,
        maxTimeoutSeconds: Number(term.maxTimeoutSeconds ?? 300),
        extra: term.extra ?? { name: 'USD Coin', version: '2' },
      },
      payload: { signature, authorization },
      extensions: {},
    };
  }
  return {
    x402Version: 1,
    scheme: term.scheme ?? 'exact',
    network: term.network,
    payload: { signature, authorization },
  };
}

export const encodeHeader = (payload) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

export function decodeSettlement(header) {
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export async function payAndFetch({ url, init, challenge, term, client, account, maxAtomic, nowSeconds }) {
  const value = BigInt(termAmount(term));
  if (maxAtomic !== undefined && value > BigInt(maxAtomic))
    throw new Error(`term value ${value} exceeds cap ${maxAtomic}; refusing to sign`);

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const authorization = buildAuthorization(account.address, term, now);
  const signature = await client.signTypedData(typedData(authorization, term));
  const version = challenge?.x402Version === 2 ? 2 : 1;
  const payload = envelope({ version, term, signature, authorization, challenge, url });

  const encoded = encodeHeader(payload);
  const headers = { ...(init.headers ?? {}), 'X-PAYMENT': encoded, 'PAYMENT-SIGNATURE': encoded };
  const res = await fetch(url, { ...init, headers });
  return { res, payload, version };
}
