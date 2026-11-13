/** Renders the app icons (PNG) from SVG with headless Chromium. Run: npm run icons */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const svg = (pad: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 110}" fill="#0f6b4a"/>
  <g transform="translate(${pad},${pad}) scale(${(512 - 2 * pad) / 512})">
    <path d="M118 196 256 132l138 64v156L256 416 118 352z" fill="#f59f00"/>
    <path d="M118 196 256 260l138-64M256 260v156" stroke="#7a4d00" stroke-width="14" fill="none" stroke-linejoin="round"/>
    <path d="M187 164l138 64v52" stroke="#fff3d6" stroke-width="18" fill="none" stroke-linecap="round"/>
    <text x="256" y="112" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="86" fill="#fff" text-anchor="middle">KG</text>
  </g>
</svg>`;

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/favicon.svg', svg(0));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium' });
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['maskable-512', 512, 70], ['apple-touch-icon', 180, 0]] as const) {
  await page.setViewportSize({ width: size, height: size });
  const body = name === 'apple-touch-icon' ? svg(0).replace('rx="110"', 'rx="0"') : svg(pad);
  await page.setContent(`<html><body style="margin:0;background:transparent">${body.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/${name}.png`, omitBackground: true });
}
await browser.close();
console.log('icons written to public/icons');
