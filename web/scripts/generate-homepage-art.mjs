// Static fallback for the GPU scene. Run: node scripts/generate-homepage-art.mjs
import { writeFile } from "node:fs/promises";
import { toAsciiGrid, gridToSvg } from "asciify-engine/headless";

const width = 960, height = 640;
const data = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height, p = u * width / height;
    const bend = .52 + .14 * Math.sin(p * 2.8) + .06 * Math.cos(p * 5.2);
    const split = .24 * (.5 + .5 * Math.sin(p * 1.5));
    const ribbon = Math.max(...[-split, 0, split].map(d => Math.exp(-(((v - bend + d) * 14) ** 2))));
    const ribs = .45 + .55 * ((.5 + .5 * Math.sin(p * 38 + v * 24)) ** 3);
    const tone = Math.round(Math.min(1, ribbon * (.22 + ribs * .56)) * 255);
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = tone; data[i + 3] = 255;
  }
}
const grid = toAsciiGrid({ data, width, height, channels: 4 }, {
  columns: 160, cellAspect: 1.6, mode: "tone", charset: " .,:;-=+*/<>[]{}01",
  background: "dark", levels: "none", dither: false,
});
await writeFile(new URL("../public/art/currents.svg", import.meta.url), gridToSvg(grid, { fontSize: 10, ink: "#86bb9c", color: false }));
console.log("Generated currents.svg");
