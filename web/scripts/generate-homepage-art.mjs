// Rebuild static ASCII fallbacks: node scripts/generate-homepage-art.mjs
// Sharp is also Next.js's image dependency; conversion uses Asciify's headless API.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { toAsciiGrid, gridToSvg } from "asciify-engine/headless";

for (const name of ["review", "improve", "reward"]) {
  const source = new URL(`../public/art/${name}.svg`, import.meta.url);
  const { data, info } = await sharp(await readFile(source)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const grid = toAsciiGrid({ data, width: info.width, height: info.height, channels: 4 }, {
    columns: 120, cellAspect: 1.7, mode: "tone", charset: " .,:;+*#%@",
    background: "dark", levels: "none", dither: false,
  });
  const svg = gridToSvg(grid, { fontSize: 9, ink: "#222a23", color: false });
  await writeFile(new URL(`../public/art/${name}-ascii.svg`, import.meta.url), svg);
  console.log(`Generated ${name}-ascii.svg`);
}
