import { Resvg } from "@resvg/resvg-js";

/** SVG string to PNG bytes for sendPhoto. Telegram wants a real raster; SVG uploads are rejected. */
export function svgToPng(svg: string): Uint8Array<ArrayBuffer> {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  return new Uint8Array(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer);
}
