// Cloudflare Workers Web Crypto rejects PBKDF2 counts above 100,000.
const PIN_ITERATIONS = 100_000
const textEncoder = new TextEncoder()

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function getErrorName(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof error.name === 'string'
  ) {
    return error.name
  }
  return 'UnknownError'
}

export function randomHex(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return toHex(bytes)
}

export class PinHashFailure extends Error {
  readonly stage: 'key_import' | 'derive_bits'
  readonly errorType: string

  constructor(stage: 'key_import' | 'derive_bits', errorType: string) {
    super('PIN hashing failed')
    this.name = 'PinHashFailure'
    this.stage = stage
    this.errorType = errorType
  }
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return toHex(new Uint8Array(digest))
}

export async function keyedHash(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(value))
  return toHex(new Uint8Array(signature))
}

export async function hashPin(
  pin: string,
  saltHex: string,
  pepper: string,
  iterations = PIN_ITERATIONS,
): Promise<string> {
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      'raw',
      textEncoder.encode(`${pin}:${pepper}`),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    )
  } catch (error) {
    throw new PinHashFailure('key_import', getErrorName(error))
  }

  let bits: ArrayBuffer
  try {
    bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: { name: 'SHA-256' },
      salt: fromHex(saltHex),
      iterations,
    }, key, 256)
  } catch (error) {
    throw new PinHashFailure('derive_bits', getErrorName(error))
  }
  return toHex(new Uint8Array(bits))
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = textEncoder.encode(left)
  const b = textEncoder.encode(right)
  let difference = a.length ^ b.length
  const maxLength = Math.max(a.length, b.length)
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  }
  return difference === 0
}

export { PIN_ITERATIONS }
