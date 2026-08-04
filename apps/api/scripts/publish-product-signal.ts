import "dotenv/config";

const [sku, name, productUrl, priceText] = process.argv.slice(2);
if (!sku || !name || !productUrl) {
  console.error('Usage: pnpm monitor:signal <sku> "<name>" <product-url> [price]');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 4310);
const host = process.env.HOST && process.env.HOST !== "0.0.0.0" ? process.env.HOST : "127.0.0.1";
const response = await fetch(`http://${host}:${port}/v1/admin/monitor/signals`, {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN ?? "development-admin-token-change-me"}`, "content-type": "application/json" },
  body: JSON.stringify({ site: "pokemon_center_us", sku, name, productUrl, available: true, price: priceText ? Number(priceText) : undefined, source: "manual-cli" }),
});
const body = await response.text();
if (!response.ok) {
  console.error(`Monitor rejected the signal (${response.status}): ${body}`);
  process.exit(1);
}
console.log(body);
