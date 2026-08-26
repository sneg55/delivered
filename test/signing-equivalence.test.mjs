import { test } from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount } from 'viem/accounts';
import {
  concat, encodeAbiParameters, hashTypedData, keccak256, recoverTypedDataAddress, toBytes,
} from 'viem';
import { typedData, buildAuthorization, termAmount } from '../src/x402-v2.mjs';

const THROWAWAY_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(THROWAWAY_KEY);

const V1_TERM = {
  scheme: 'exact',
  network: 'base',
  maxAmountRequired: '1000',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  payTo: '0x209693Bc6afc0C5328bA36FaF03C514EF312287C',
  maxTimeoutSeconds: 60,
  extra: { name: 'USDC', version: '2' },
};
const V2_TERM = { ...V1_TERM, network: 'eip155:8453', amount: '1000', maxAmountRequired: undefined };

const FIXED_AUTH = {
  from: account.address,
  to: V1_TERM.payTo,
  value: '1000',
  validAfter: '1740671489',
  validBefore: '1740672149',
  nonce: '0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480',
};

const DOMAIN_TYPEHASH = keccak256(
  toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
const TRANSFER_TYPEHASH = keccak256(
  toBytes('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'));

function eip3009Digest(auth, { name, version, chainId, verifyingContract }) {
  const domainSeparator = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
    [DOMAIN_TYPEHASH, keccak256(toBytes(name)), keccak256(toBytes(version)), BigInt(chainId), verifyingContract],
  ));
  const structHash = keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' },
     { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes32' }],
    [TRANSFER_TYPEHASH, auth.from, auth.to, BigInt(auth.value),
     BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce],
  ));
  return keccak256(concat(['0x1901', domainSeparator, structHash]));
}

test('the typed data matches an EIP-3009 digest derived independently of viem', () => {
  const mine = hashTypedData(typedData(FIXED_AUTH, V1_TERM));
  const byHand = eip3009Digest(FIXED_AUTH, {
    name: 'USDC', version: '2', chainId: 8453, verifyingContract: V1_TERM.asset,
  });
  assert.equal(mine, byHand);
});

test('a CAIP-2 term and its named equivalent sign the same digest', () => {
  assert.equal(hashTypedData(typedData(FIXED_AUTH, V2_TERM)), hashTypedData(typedData(FIXED_AUTH, V1_TERM)));
});

test('the signature recovers to the paying account', async () => {
  const data = typedData(FIXED_AUTH, V2_TERM);
  const signature = await account.signTypedData(data);
  assert.equal(await recoverTypedDataAddress({ ...data, signature }), account.address);
});

test('the amount survives the v1 to v2 field rename that the old shim existed to patch', () => {
  assert.equal(V2_TERM.maxAmountRequired, undefined);
  assert.equal(termAmount(V2_TERM), '1000');
  assert.equal(buildAuthorization(account.address, V2_TERM, 1_740_672_089).value, '1000');
});
