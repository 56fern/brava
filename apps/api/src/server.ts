import { createApp } from "./app.js";
import { authEnabled, runBetterAuthMigrations } from "./auth.js";
import { assertProductionSecrets, config } from "./config.js";
import { closeDatabasePool, getDatabasePool, pingDatabase } from "./database.js";
import { importJsonLicenses } from "./import-json-licenses.js";
import { runBravaMigrations } from "./migrations.js";
import { ProductMonitorHub } from "./monitor.js";
import { ProductMonitorWorker } from "./monitor-worker.js";
import { createLicenseStore } from "./repository-factory.js";

async function prepareDatabase(): Promise<void> {
  if (!config.databaseUrl) return;

  const pool = getDatabasePool();
  await pingDatabase(pool);
  if (authEnabled) await runBetterAuthMigrations();
  await runBravaMigrations(pool);

  if (config.licenseStorage === "postgres" && config.importJsonLicenses) {
    const imported = await importJsonLicenses(pool, config.dataFile);
    console.log(imported.skipped
      ? `Legacy JSON license import already completed; skipped (${imported.licenses} licenses, ${imported.devices} device bindings).`
      : `Imported ${imported.licenses} JSON license${imported.licenses === 1 ? "" : "s"} and ${imported.devices} device binding${imported.devices === 1 ? "" : "s"}.`);
  }
}

async function main(): Promise<void> {
  assertProductionSecrets();
  await prepareDatabase();

  const repository = createLicenseStore();
  await repository.ping();

  const monitor = new ProductMonitorHub();
  const monitorWorker = new ProductMonitorWorker(monitor, config.monitorSourceUrls, config.monitorIntervalMs, config.monitorRequestTimeoutMs);
  const server = createApp(repository, monitor).listen(config.port, config.host);

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  monitorWorker.start();
  console.log(`Brava license API listening on http://${config.host}:${config.port}`);
  console.log(`Brava license storage: ${config.licenseStorage}.`);
  console.log(`Brava monitor configured with ${config.monitorSourceUrls.length} source${config.monitorSourceUrls.length === 1 ? "" : "s"}.`);

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = (signal: NodeJS.Signals): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      console.log(`Received ${signal}; shutting down Brava API.`);
      monitorWorker.stop();
      await new Promise<void>((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
      await repository.close();
      await closeDatabasePool();
    })();
    return shutdownPromise;
  };

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal).then(
        () => { process.exitCode = 0; },
        (error) => {
          console.error("Brava API shutdown failed.", error);
          process.exitCode = 1;
        },
      );
    });
  }
}

main().catch(async (error) => {
  console.error("Brava API failed to start.", error);
  await closeDatabasePool().catch(() => undefined);
  process.exitCode = 1;
});
