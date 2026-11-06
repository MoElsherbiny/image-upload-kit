/**
 * Vendored TypeScript implementation of BlurHash (encode, decode, isBlurhashValid).
 * Original work Copyright (c) 2018 Wolt Enterprises (MIT License).
 * See THIRD_PARTY_NOTICES.md at the repository root.
 */

const DIGIT_CHARACTERS = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z', 'a', 'b', 'c', 'd',
  'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n',
  'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x',
  'y', 'z', '#', '$', '%', '*', '+', ',', '-', '.',
  ':', ';', '=', '?', '@', '[', ']', '^', '_', '{',
  '|', '}', '~',
] as const;

export function decode83(str: string): number {
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const digit = DIGIT_CHARACTERS.indexOf(
      c as (typeof DIGIT_CHARACTERS)[number],
    );
    value = value * 83 + digit;
  }
  return value;
}

export function encode83(n: number, length: number): string {
  let result = '';
  for (let i = 1; i <= length; i++) {
    const digit = (Math.floor(n) / Math.pow(83, length - i)) % 83;
    result += DIGIT_CHARACTERS[Math.floor(digit)];
  }
  return result;
}

export function sRGBToLinear(value: number): number {
  const v = value / 255;
  if (v <= 0.04045) {
    return v / 12.92;
  }
  return Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearTosRGB(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  if (v <= 0.0031308) {
    return Math.trunc(v * 12.92 * 255 + 0.5);
  }
  return Math.trunc((1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255 + 0.5);
}

export function sign(n: number): number {
  return n < 0 ? -1 : 1;
}

export function signPow(val: number, exp: number): number {
  return sign(val) * Math.pow(Math.abs(val), exp);
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    this.message = message;
  }
}

function validateBlurhash(blurhash: string): void {
  if (!blurhash || blurhash.length < 6) {
    throw new ValidationError(
      'The blurhash string must be at least 6 characters',
    );
  }
  const sizeFlag = decode83(blurhash[0]);
  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;
  if (blurhash.length !== 4 + 2 * numX * numY) {
    throw new ValidationError(
      `blurhash length mismatch: length is ${blurhash.length} but it should be ${4 + 2 * numX * numY}`,
    );
  }
}

export function isBlurhashValid(blurhash: string): {
  result: boolean;
  errorReason?: string;
} {
  try {
    validateBlurhash(blurhash);
  } catch (error) {
    return {
      result: false,
      errorReason: error instanceof Error ? error.message : String(error),
    };
  }
  return { result: true };
}

function decodeDC(value: number): [number, number, number] {
  const intR = value >> 16;
  const intG = (value >> 8) & 255;
  const intB = value & 255;
  return [sRGBToLinear(intR), sRGBToLinear(intG), sRGBToLinear(intB)];
}

function decodeAC(
  value: number,
  maximumValue: number,
): [number, number, number] {
  const quantR = Math.floor(value / (19 * 19));
  const quantG = Math.floor(value / 19) % 19;
  const quantB = value % 19;
  return [
    signPow((quantR - 9) / 9, 2.0) * maximumValue,
    signPow((quantG - 9) / 9, 2.0) * maximumValue,
    signPow((quantB - 9) / 9, 2.0) * maximumValue,
  ];
}

export function decode(
  blurhash: string,
  width: number,
  height: number,
  punch?: number,
): Uint8ClampedArray {
  validateBlurhash(blurhash);
  const effectivePunch = (punch ?? 0) | 1;
  const sizeFlag = decode83(blurhash[0]);
  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;
  const quantisedMaximumValue = decode83(blurhash[1]);
  const maximumValue = (quantisedMaximumValue + 1) / 166;

  const colors = new Array<[number, number, number]>(numX * numY);
  for (let i = 0; i < colors.length; i++) {
    if (i === 0) {
      const value = decode83(blurhash.substring(2, 6));
      colors[i] = decodeDC(value);
    } else {
      const value = decode83(blurhash.substring(4 + i * 2, 6 + i * 2));
      colors[i] = decodeAC(value, maximumValue * effectivePunch);
    }
  }

  const bytesPerRow = width * 4;
  const pixels = new Uint8ClampedArray(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = 0; j < numY; j++) {
        for (let i = 0; i < numX; i++) {
          const basis =
            Math.cos((Math.PI * x * i) / width) *
            Math.cos((Math.PI * y * j) / height);
          const color = colors[i + j * numX];
          r += color[0] * basis;
          g += color[1] * basis;
          b += color[2] * basis;
        }
      }
      const offset = 4 * x + y * bytesPerRow;
      pixels[offset] = linearTosRGB(r);
      pixels[offset + 1] = linearTosRGB(g);
      pixels[offset + 2] = linearTosRGB(b);
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

function multiplyBasisFunction(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  basisFunction: (x: number, y: number) => number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const bytesPerRow = width * 4;
  for (let x = 0; x < width; x++) {
    const bytesPerPixelX = 4 * x;
    for (let y = 0; y < height; y++) {
      const basePixelIndex = bytesPerPixelX + y * bytesPerRow;
      const basis = basisFunction(x, y);
      r += basis * sRGBToLinear(pixels[basePixelIndex]);
      g += basis * sRGBToLinear(pixels[basePixelIndex + 1]);
      b += basis * sRGBToLinear(pixels[basePixelIndex + 2]);
    }
  }
  const scale = 1 / (width * height);
  return [r * scale, g * scale, b * scale];
}

function encodeDC(value: [number, number, number]): number {
  const roundedR = linearTosRGB(value[0]);
  const roundedG = linearTosRGB(value[1]);
  const roundedB = linearTosRGB(value[2]);
  return (roundedR << 16) + (roundedG << 8) + roundedB;
}

function encodeAC(
  value: [number, number, number],
  maximumValue: number,
): number {
  const quantR = Math.floor(
    Math.max(
      0,
      Math.min(18, Math.floor(signPow(value[0] / maximumValue, 0.5) * 9 + 9.5)),
    ),
  );
  const quantG = Math.floor(
    Math.max(
      0,
      Math.min(18, Math.floor(signPow(value[1] / maximumValue, 0.5) * 9 + 9.5)),
    ),
  );
  const quantB = Math.floor(
    Math.max(
      0,
      Math.min(18, Math.floor(signPow(value[2] / maximumValue, 0.5) * 9 + 9.5)),
    ),
  );
  return quantR * 19 * 19 + quantG * 19 + quantB;
}

export function encode(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  componentX: number,
  componentY: number,
): string {
  if (componentX < 1 || componentX > 9 || componentY < 1 || componentY > 9) {
    throw new ValidationError('BlurHash must have between 1 and 9 components');
  }
  if (width * height * 4 !== pixels.length) {
    throw new ValidationError('Width and height must match the pixels array');
  }

  const factors: Array<[number, number, number]> = [];
  for (let y = 0; y < componentY; y++) {
    for (let x = 0; x < componentX; x++) {
      const normalisation = x === 0 && y === 0 ? 1 : 2;
      const factor = multiplyBasisFunction(pixels, width, height, (i, j) =>
        normalisation *
        Math.cos((Math.PI * x * i) / width) *
        Math.cos((Math.PI * y * j) / height),
      );
      factors.push(factor);
    }
  }

  const dc = factors[0];
  const ac = factors.slice(1);
  let blurhash = '';
  const sizeFlag = componentX - 1 + (componentY - 1) * 9;
  blurhash += encode83(sizeFlag, 1);

  let maximumValue: number;
  if (ac.length > 0) {
    const actualMaximumValue = Math.max(...ac.map((val) => Math.max(...val)));
    const quantisedMaximumValue = Math.floor(
      Math.max(0, Math.min(82, Math.floor(actualMaximumValue * 166 - 0.5))),
    );
    maximumValue = (quantisedMaximumValue + 1) / 166;
    blurhash += encode83(quantisedMaximumValue, 1);
  } else {
    maximumValue = 1;
    blurhash += encode83(0, 1);
  }

  blurhash += encode83(encodeDC(dc), 4);
  for (const factor of ac) {
    blurhash += encode83(encodeAC(factor, maximumValue), 2);
  }
  return blurhash;
}
