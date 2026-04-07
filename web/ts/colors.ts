/** Deterministic color from a username — same user always gets same color */
const PALETTE = [
  '#117743', // green (classic anon)
  '#1e40af', // blue
  '#b91c1c', // red
  '#7c3aed', // purple
  '#c2410c', // orange
  '#0e7490', // teal
  '#a16207', // amber
  '#be185d', // pink
  '#4338ca', // indigo
  '#15803d', // emerald
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function usernameColor(username: string): string {
  return PALETTE[hashString(username) % PALETTE.length];
}
