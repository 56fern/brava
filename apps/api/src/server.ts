import { createApp } from "./app.js";
import { assertProductionSecrets, config } from "./config.js";
import { ProductMonitorHub } from "./monitor.js";
import { ProductMonitorWorker } from "./monitor-worker.js";

assertProductionSecrets();
const monitor = new ProductMonitorHub();
const monitorWorker = new ProductMonitorWorker(monitor, config.monitorSourceUrls, config.monitorIntervalMs, config.monitorRequestTimeoutMs);
monitorWorker.start();
const server = createApp(undefined, monitor).listen(config.port, config.host, () => {
  console.log(`Brava license API listening on http://${config.host}:${config.port}`);
  console.log(`Brava monitor configured with ${config.monitorSourceUrls.length} source${config.monitorSourceUrls.length === 1 ? "" : "s"}.`);
});
server.ref();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  monitorWorker.stop();
  server.close(() => process.exit(0));
});
