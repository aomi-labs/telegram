import { createServer } from "node:http";
import { once } from "node:events";
import { fetch as undiciFetch } from "undici";
import { expect, it } from "vitest";
import { BotApi } from "../src/telegram/api.ts";

it("sends a PNG multipart upload through the real proxy-capable HTTP implementation", async () => {
  let received: FormData | undefined;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    try {
      received = await new Request("http://local/upload", { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "" }, body: Buffer.concat(chunks) }).formData();
    } catch { /* Wrong body serialization must be rejected like Telegram. */ }
    const photo = received?.get("photo");
    res.writeHead(photo instanceof Blob ? 200 : 400, { "content-type": "application/json" });
    res.end(JSON.stringify(photo instanceof Blob ? { ok: true, result: true } : { ok: false, error_code: 400, description: "there is no photo in the request" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as { port: number };
    const api = new BotApi("test", `http://127.0.0.1:${address.port}`, undiciFetch as unknown as typeof fetch);
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await api.sendPhoto("42", png, "<code>WETH</code>", { text: "Open chart", web_app: { url: "https://example.com/chart" } });
    expect(received?.get("chat_id")).toBe("42");
    expect(received?.get("caption")).toBe("<code>WETH</code>");
    expect(received?.get("parse_mode")).toBe("HTML");
    const photo = received?.get("photo") as File;
    expect(photo.name).toBe("chart.png");
    expect(photo.type).toBe("image/png");
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(png);
    expect(JSON.parse(String(received?.get("reply_markup"))).inline_keyboard[0][0].text).toBe("Open chart");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
