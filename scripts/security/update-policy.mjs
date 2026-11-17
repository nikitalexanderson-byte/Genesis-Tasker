import { readFileSync, writeFileSync } from 'node:fs';
import { createPublicKey, sign, verify } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function validatePolicy(value) {
  if (value.schema !== 1 || value.package !== 'ru.genesis.calendar') throw Error('Policy identity');
  for (const key of ['sequence','issuedAt','activatesAt','expiresAt']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error('Policy integer');
  if (value.sequence < 1 || value.issuedAt > value.activatesAt || value.activatesAt >= value.expiresAt || value.expiresAt-value.issuedAt > 180*86400) throw Error('Policy lifetime');
  if (Object.keys(value.channels).sort().join() !== 'play,site') throw Error('Policy channels');
  for (const row of Object.values(value.channels)) {
    if (!Number.isInteger(row.minimumVersionCode) || row.minimumVersionCode < 0 || row.minimumVersionCode > 2147483647 ||
        !Number.isInteger(row.minimumCryptoProtocol) || row.minimumCryptoProtocol < 0 || row.minimumCryptoProtocol > 100 ||
        row.minimumCryptoProtocol > 0 && row.minimumVersionCode === 0) throw Error('Policy floor');
  }
  return value;
}
export function signedPolicy(value, privateKey) {
  const payload = Buffer.from(JSON.stringify(validatePolicy(value)));
  return { payload: payload.toString('base64'), signature: sign('sha256',payload,{key:privateKey,dsaEncoding:'der'}).toString('base64') };
}
export function verifiedPolicy(envelope, publicKey) {
  const payload = Buffer.from(envelope.payload,'base64');
  if (payload.length > 4096 || !verify('sha256',payload,publicKey,Buffer.from(envelope.signature,'base64'))) throw Error('Policy signature');
  return validatePolicy(JSON.parse(payload));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, keyPath, output, evidencePath] = process.argv.slice(2);
  if (!input || !keyPath || !output) throw Error('Usage: node scripts/security/update-policy.mjs policy.json external-private.pem output.json [activation-evidence.json]');
  const policy = validatePolicy(JSON.parse(readFileSync(input,'utf8')));
  if (Object.values(policy.channels).some(row => row.minimumVersionCode || row.minimumCryptoProtocol)) {
    const evidence = JSON.parse(readFileSync(evidencePath,'utf8'));
    for (const requirement of ['deliveryVerified','signatureUpgradeVerified','emergencyExportRestoreVerified','cryptoReviewApproved','entrypointTestsPassed'])
      if (evidence[requirement] !== true) throw Error(`Activation evidence missing: ${requirement}`);
  }
  const privateKey = readFileSync(keyPath,'utf8');
  const signed = signedPolicy(policy,privateKey);
  verifiedPolicy(signed,createPublicKey(privateKey));
  writeFileSync(output,JSON.stringify(signed)+'\n');
  console.log(`Signed policy ${policy.sequence}; private key was not copied or printed.`);
}
