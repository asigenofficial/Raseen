// Code 39 narrow/wide patterns, alternating five bars and four spaces.
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*';
const PATTERNS = [
  'nnnwwnwnn', 'wnnwnnnnw', 'nnwwnnnnw', 'wnwwnnnnn', 'nnnwwnnnw',
  'wnnwwnnnn', 'nnwwwnnnn', 'nnnwnnwnw', 'wnnwnnwnn', 'nnwwnnwnn',
  'wnnnnwnnw', 'nnwnnwnnw', 'wnwnnwnnn', 'nnnnwwnnw', 'wnnnwwnnn',
  'nnwnwwnnn', 'nnnnnwwnw', 'wnnnnwwnn', 'nnwnnwwnn', 'nnnnwwwnn',
  'wnnnnnnww', 'nnwnnnnww', 'wnwnnnnwn', 'nnnnwnnww', 'wnnnwnnwn',
  'nnwnwnnwn', 'nnnnnnwww', 'wnnnnnwwn', 'nnwnnnwwn', 'nnnnwnwwn',
  'wwnnnnnnw', 'nwwnnnnnw', 'wwwnnnnnn', 'nwnnwnnnw', 'wwnnwnnnn',
  'nwwnwnnnn', 'nwnnnnwnw', 'wwnnnnwnn', 'nwwnnnwnn', 'nwnwnwnnn',
  'nwnwnnnwn', 'nwnnnwnwn', 'nnnwnwnwn', 'nwnnwnwnn',
];
const CODES = Object.fromEntries([...CHARS].map((char, i) => [char, PATTERNS[i]]));

export function code39Svg(input) {
  const value = String(input || '').trim().toUpperCase();
  if (!value || value.length > 20 || [...value].some(char => !CODES[char] || char === '*')) {
    throw new Error('اكتب حتى 20 حرفاً إنجليزياً أو رقماً للباركود');
  }
  let x = 20;
  const bars = [];
  for (const char of `*${value}*`) {
    [...CODES[char]].forEach((part, i) => {
      const width = part === 'w' ? 5 : 2;
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="90"/>`);
      x += width;
    });
    x += 2;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x + 18} 90" width="${x + 18}" height="90" role="img" aria-label="Code 39 ${value}" style="max-width:100%;height:auto;background:#fff;fill:#111">${bars.join('')}</svg>`;
}
