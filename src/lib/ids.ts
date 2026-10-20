/**
 * Id generation without extra dependencies.
 * crypto.randomUUID is available in Hermes/modern Expo runtimes; the fallback
 * keeps unit tests and older runtimes working.
 */
export function newId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();

  let id = '';
  for (let i = 0; i < 4; i += 1) {
    id += Math.random().toString(16).slice(2, 10);
  }
  return `${Date.now().toString(16)}-${id}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
