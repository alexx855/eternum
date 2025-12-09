// Hex helpers
export const strip0x = (v: string) => (v.startsWith("0x") || v.startsWith("0X") ? v.slice(2) : v);

export const toLowerHex = (v: string) => `0x${strip0x(v).toLowerCase()}`;

export const leftPadHex = (hexWithout0x: string, width: number) => hexWithout0x.padStart(width, "0");

// Normalize any hex to 0x + 64-char lowercase body
export const normalizeHex = (v: string) => {
  const body = strip0x(v).toLowerCase();
  const padded = leftPadHex(body, 64);
  return `0x${padded}`;
};

// Selector normalization equals normalizeHex
export const normalizeSelector = (v: string) => normalizeHex(v);
