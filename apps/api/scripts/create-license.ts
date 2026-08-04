import { createApp } from "../src/app.js";
import { config } from "../src/config.js";

const label = process.argv[2] ?? "Development license";
const deviceArgument = (process.argv[3] ?? "1").toLowerCase();
const owner = deviceArgument === "owner" || deviceArgument === "unlimited";
const maxDevices = owner ? null : Number(deviceArgument);
if (maxDevices !== null && (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 10)) {
  throw new Error("Device limit must be an integer from 1 to 10, or use 'unlimited' for an owner license.");
}
const server = createApp().listen(0, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start local API");
  const response = await fetch(`http://127.0.0.1:${address.port}/v1/admin/licenses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.adminToken}` },
    body: JSON.stringify({ label, role: owner ? "owner" : "user", maxDevices, expiresAt: null }),
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  server.close();
});
