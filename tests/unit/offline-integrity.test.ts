import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

const data = Buffer.from('Geometría local verificada, sin omitir la integridad.');
const compressed = gzipSync(data);
const fingerprint = (bytes: Uint8Array) => ({
  bytes: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});
const source = readFileSync('scripts/service-worker.template.js', 'utf8')
  .replace('__CACHE__', JSON.stringify('oratoria-static-prueba'))
  .replace('__ASSETS__', '[]');
const context = {
  crypto: webcrypto,
  Uint8Array,
  self: { addEventListener() {} },
};
new Script(source).runInNewContext(context);
const valid = new Script('validBytes');
const check = valid.runInNewContext(context) as (
  bytes: Uint8Array,
  asset: ReturnType<typeof fingerprint> & { decoded?: ReturnType<typeof fingerprint> },
) => Promise<boolean>;

describe('integridad offline con recursos gzip', () => {
  const asset = { ...fingerprint(compressed), decoded: fingerprint(data) };
  it('acepta la representación comprimida y la que fetch descomprimió', async () => {
    expect(await check(compressed, asset)).toBe(true);
    expect(await check(data, asset)).toBe(true);
  });
  it('rechaza alteraciones aunque la longitud siga siendo la esperada', async () => {
    const changed = Buffer.from(data);
    changed[0] = changed[0]! ^ 1;
    expect(await check(changed, asset)).toBe(false);
  });
  it('no acepta bytes descomprimidos si el build no fijó su huella', async () => {
    expect(await check(data, fingerprint(compressed))).toBe(false);
  });
});
