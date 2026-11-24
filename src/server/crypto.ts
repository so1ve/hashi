const encoder = new TextEncoder();
const decoder = new TextDecoder();

const DEFAULT_VERIFY_STATE_TTL_SECONDS = 900;
const DEFAULT_INIT_DATA_MAX_AGE_SECONDS = 900;

export const unixNow = (): number => Math.floor(Date.now() / 1000);

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }

  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function base64UrlToBytes(encoded: string): Uint8Array | null {
  if (!/^[\w-]+$/.test(encoded)) {
    return null;
  }
  const padded = encoded
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.codePointAt(i) ?? 0;
    }

    return bytes;
  } catch {
    return null;
  }
}

async function hmacSha256(
  keyData: Uint8Array<ArrayBuffer>,
  message: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return new Uint8Array(sig);
}

function toArrayBufferBytes(text: string): Uint8Array<ArrayBuffer> {
  const encoded = encoder.encode(text);
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);

  return copy;
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const randomKey = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(randomKey);
  const key = await crypto.subtle.importKey(
    "raw",
    randomKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(a)),
    crypto.subtle.sign("HMAC", key, encoder.encode(b)),
  ]);
  const bytesA = new Uint8Array(macA);
  const bytesB = new Uint8Array(macB);
  let diff = bytesA.length ^ bytesB.length;
  for (const [i, element] of bytesA.entries()) {
    diff |= (element ?? 0) ^ (bytesB[i] ?? 0);
  }

  return diff === 0;
}

export async function deriveWebhookSecret(botToken: string): Promise<string> {
  const mac = await hmacSha256(
    toArrayBufferBytes(botToken),
    "hashi:webhook-secret:v2",
  );

  return bytesToHex(mac);
}

interface VerifyStatePayload {
  c: number;
  e: number;
}

export async function signVerifyState(
  botToken: string,
  chatId: number,
  ttlSeconds: number = DEFAULT_VERIFY_STATE_TTL_SECONDS,
  now: number = unixNow(),
): Promise<string> {
  const payload: VerifyStatePayload = {
    c: chatId,
    e: now + ttlSeconds,
  };
  const encodedPayload = bytesToBase64Url(
    encoder.encode(JSON.stringify(payload)),
  );
  const sig = await hmacSha256(
    toArrayBufferBytes(botToken),
    `hashi:verify-state:${encodedPayload}`,
  );

  return `${encodedPayload}.${bytesToBase64Url(sig)}`;
}

export async function verifyStateToken(
  botToken: string,
  token: string,
  now: number = unixNow(),
): Promise<number | null> {
  const dotIdx = token.indexOf(".");
  if (dotIdx <= 0 || dotIdx !== token.lastIndexOf(".")) {
    return null;
  }
  const encodedPayload = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);
  if (!encodedPayload || !providedSig) {
    return null;
  }

  const expectedSig = bytesToBase64Url(
    await hmacSha256(
      toArrayBufferBytes(botToken),
      `hashi:verify-state:${encodedPayload}`,
    ),
  );
  if (!(await timingSafeEqual(providedSig, expectedSig))) {
    return null;
  }

  const bytes = base64UrlToBytes(encodedPayload);
  if (!bytes) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      decoder.decode(bytes),
    ) as Partial<VerifyStatePayload>;
    if (
      typeof parsed.c !== "number" ||
      !Number.isSafeInteger(parsed.c) ||
      typeof parsed.e !== "number" ||
      !Number.isFinite(parsed.e) ||
      parsed.e < now
    ) {
      return null;
    }

    return parsed.c;
  } catch {
    return null;
  }
}

export async function verifyTelegramInitData(
  botToken: string,
  initData: string,
  maxAgeSeconds: number = DEFAULT_INIT_DATA_MAX_AGE_SECONDS,
  now: number = unixNow(),
): Promise<{ userId: number } | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) {
    return null;
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number.parseInt(authDateRaw, 10) : Number.NaN;
  if (
    !Number.isFinite(authDate) ||
    now - authDate > maxAgeSeconds ||
    authDate - now > 60
  ) {
    return null;
  }

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") {
      pairs.push(`${key}=${value}`);
    }
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = await hmacSha256(
    toArrayBufferBytes("WebAppData"),
    botToken,
  );
  const expectedHash = bytesToHex(await hmacSha256(secretKey, dataCheckString));
  if (!(await timingSafeEqual(hash.toLowerCase(), expectedHash))) {
    return null;
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    return null;
  }
  try {
    const user = JSON.parse(userRaw) as { id?: unknown };
    if (typeof user.id !== "number" || !Number.isSafeInteger(user.id)) {
      return null;
    }

    return { userId: user.id };
  } catch {
    return null;
  }
}
