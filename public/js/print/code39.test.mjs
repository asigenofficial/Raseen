import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./code39.js', import.meta.url), 'utf8');
const { code39Svg } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const svg = code39Svg('A');
const widths = [...svg.matchAll(/<rect[^>]+width="(\d+)"/g)].map(match => Number(match[1]));

assert.deepEqual(widths.slice(5, 10), [5, 2, 2, 2, 5]);
assert.equal(widths.length, 15);
assert.match(svg, /Code 39 A/);
assert.throws(() => code39Svg('عربي'));
