import crypto from "node:crypto";
import type { WebhookCustomerStateChangedPayload } from "@polar-sh/sdk/models/components/webhookcustomerstatechangedpayload";
import type pg from "pg";
import { config } from "./config.js";
import { generateLicenseKey, hashLicenseKey } from "./crypto.js";
import { getDatabasePool } from "./database.js";

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing"] as const;

type SubscriptionRow = {
  id: string;
  polar_subscription_id: string;
  status: string;
  current_period_end: Date | null;
};

type LicenseRow = {
  id: string;
  status: "active" | "revoked";
};

export type PolarEntitlement = {
  active: boolean;
  subscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  licenseProvisioned: boolean;
};

export type PolarLicenseResult =
  | {
    ok: true;
    key: string;
    license: {
      id: string;
      label: string;
      status: "active";
      maxDevices: 1;
      expiresAt: string | null;
    };
  }
  | { ok: false; error: "entitlement_required" | "already_provisioned" | "license_not_provisioned" };

function requirePolarProduct(): string {
  if (!config.polarProductId) throw new Error("POLAR_PRODUCT_ID is not configured.");
  return config.polarProductId;
}

async function findActiveSubscription(client: pg.Pool | pg.PoolClient, userId: string): Promise<SubscriptionRow | null> {
  const result = await client.query<SubscriptionRow>(
    `SELECT id, polar_subscription_id, status, current_period_end
       FROM brava_subscriptions
      WHERE auth_user_id = $1
        AND polar_product_id = $2
        AND status = ANY($3::text[])
        AND (current_period_end IS NULL OR current_period_end > now())
      ORDER BY current_period_end DESC NULLS FIRST, updated_at DESC
      LIMIT 1`,
    [userId, requirePolarProduct(), [...ACTIVE_SUBSCRIPTION_STATUSES]],
  );
  return result.rows[0] ?? null;
}

export async function getPolarEntitlement(userId: string): Promise<PolarEntitlement> {
  const pool = getDatabasePool();
  const subscription = await findActiveSubscription(pool, userId);
  if (!subscription) {
    return { active: false, subscriptionId: null, status: null, currentPeriodEnd: null, licenseProvisioned: false };
  }
  const license = await pool.query<{ present: boolean }>(
    `SELECT true AS present
       FROM brava_licenses
      WHERE auth_user_id = $1 AND source = 'polar' AND status = 'active'
      LIMIT 1`,
    [userId],
  );
  return {
    active: true,
    subscriptionId: subscription.polar_subscription_id,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end?.toISOString() ?? null,
    licenseProvisioned: Boolean(license.rows[0]?.present),
  };
}

async function withUserLicenseLock<T>(userId: string, operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`brava:polar-license:${userId}`]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function successfulLicenseResult(key: string, id: string, expiresAt: Date | null): PolarLicenseResult {
  return {
    ok: true,
    key,
    license: {
      id,
      label: "Brava subscription",
      status: "active",
      maxDevices: 1,
      expiresAt: expiresAt?.toISOString() ?? null,
    },
  };
}

/**
 * Provisions a key once for an entitled user. If an active key already exists,
 * the caller gets a conflict result rather than rotating it without warning.
 * The plaintext key is never persisted and is returned only from this call.
 */
export async function provisionPolarLicense(userId: string): Promise<PolarLicenseResult> {
  return withUserLicenseLock(userId, async (client) => {
    const subscription = await findActiveSubscription(client, userId);
    if (!subscription) return { ok: false, error: "entitlement_required" };

    const existing = await client.query<LicenseRow>(
      `SELECT id, status
         FROM brava_licenses
        WHERE auth_user_id = $1 AND source = 'polar'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE`,
      [userId],
    );
    const license = existing.rows[0];
    if (license?.status === "active") return { ok: false, error: "already_provisioned" };

    const key = generateLicenseKey();
    const keyHash = hashLicenseKey(key);
    const licenseId = license?.id ?? crypto.randomUUID();
    if (license) {
      await client.query(
        `UPDATE brava_licenses
            SET key_hash = $2, label = 'Brava subscription', role = 'user', status = 'active',
                max_devices = 1, expires_at = $3, subscription_id = $4, updated_at = now()
          WHERE id = $1 AND source = 'polar'`,
        [licenseId, keyHash, subscription.current_period_end, subscription.id],
      );
      await client.query("DELETE FROM brava_license_devices WHERE license_id = $1", [licenseId]);
    } else {
      await client.query(
        `INSERT INTO brava_licenses
          (id, key_hash, label, role, status, max_devices, expires_at, auth_user_id, subscription_id, source, created_at, updated_at)
         VALUES ($1, $2, 'Brava subscription', 'user', 'active', 1, $3, $4, $5, 'polar', now(), now())`,
        [licenseId, keyHash, subscription.current_period_end, userId, subscription.id],
      );
    }
    return successfulLicenseResult(key, licenseId, subscription.current_period_end);
  });
}

/**
 * Explicitly rotates an already-provisioned Polar key and clears its device
 * bindings. Admin and owner licenses are never selected or modified.
 */
export async function rotatePolarLicense(userId: string): Promise<PolarLicenseResult> {
  return withUserLicenseLock(userId, async (client) => {
    const subscription = await findActiveSubscription(client, userId);
    if (!subscription) return { ok: false, error: "entitlement_required" };
    const existing = await client.query<LicenseRow>(
      `SELECT id, status
         FROM brava_licenses
        WHERE auth_user_id = $1 AND source = 'polar'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE`,
      [userId],
    );
    const license = existing.rows[0];
    if (!license) return { ok: false, error: "license_not_provisioned" };

    const key = generateLicenseKey();
    await client.query(
      `UPDATE brava_licenses
          SET key_hash = $2, status = 'active', expires_at = $3, subscription_id = $4, updated_at = now()
        WHERE id = $1 AND source = 'polar'`,
      [license.id, hashLicenseKey(key), subscription.current_period_end, subscription.id],
    );
    await client.query("DELETE FROM brava_license_devices WHERE license_id = $1", [license.id]);
    return successfulLicenseResult(key, license.id, subscription.current_period_end);
  });
}

export type PolarReconciliationResult = {
  duplicate: boolean;
  customerId: string;
  authUserId: string | null;
  activeSubscriptions: number;
};

/**
 * Reconciles Polar's signed customer.state_changed snapshot. The Better Auth
 * Polar plugin performs signature verification before invoking this function.
 */
export async function reconcilePolarCustomerState(payload: WebhookCustomerStateChangedPayload): Promise<PolarReconciliationResult> {
  const customer = payload.data;
  const authUserId = customer.externalId ?? null;
  const eventId = `${customer.id}:${payload.timestamp.toISOString()}`;
  const payloadJson = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
  const client = await getDatabasePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`brava:polar-customer:${customer.id}`]);
    const accepted = await client.query(
      `INSERT INTO brava_webhook_events
        (provider, provider_event_id, event_type, status, payload_sha256)
       VALUES ('polar', $1, $2, 'processing', $3)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING provider_event_id`,
      [eventId, payload.type, payloadHash],
    );
    if (!accepted.rowCount) {
      await client.query("COMMIT");
      return { duplicate: true, customerId: customer.id, authUserId, activeSubscriptions: customer.activeSubscriptions.length };
    }

    const activeIds: string[] = [];
    for (const subscription of customer.activeSubscriptions) {
      activeIds.push(subscription.id);
      await client.query(
        `INSERT INTO brava_subscriptions
          (id, auth_user_id, polar_subscription_id, polar_customer_id, polar_product_id, status,
           current_period_start, current_period_end, cancel_at_period_end, ended_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, $10, now())
         ON CONFLICT (polar_subscription_id) DO UPDATE SET
           auth_user_id = EXCLUDED.auth_user_id,
           polar_customer_id = EXCLUDED.polar_customer_id,
           polar_product_id = EXCLUDED.polar_product_id,
           status = EXCLUDED.status,
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           cancel_at_period_end = EXCLUDED.cancel_at_period_end,
           ended_at = NULL,
           updated_at = now()`,
        [
          crypto.randomUUID(), authUserId, subscription.id, customer.id, subscription.productId, subscription.status,
          subscription.currentPeriodStart, subscription.currentPeriodEnd, subscription.cancelAtPeriodEnd, subscription.createdAt,
        ],
      );
    }

    await client.query(
      `UPDATE brava_subscriptions
          SET status = 'revoked', ended_at = COALESCE(ended_at, now()), updated_at = now()
        WHERE polar_customer_id = $1
          AND NOT (polar_subscription_id = ANY($2::text[]))`,
      [customer.id, activeIds],
    );

    // Only subscription-managed licenses are reconciled. Admin and owner keys
    // remain untouched even when a customer loses their Polar entitlement.
    await client.query(
      `UPDATE brava_licenses AS license
          SET status = CASE
                WHEN subscription.status = ANY($2::text[])
                 AND subscription.polar_product_id = $3
                 AND (subscription.current_period_end IS NULL OR subscription.current_period_end > now())
                THEN 'active' ELSE 'revoked' END,
              expires_at = subscription.current_period_end,
              auth_user_id = COALESCE(subscription.auth_user_id, license.auth_user_id),
              updated_at = now()
         FROM brava_subscriptions AS subscription
        WHERE license.subscription_id = subscription.id
          AND license.source = 'polar'
          AND subscription.polar_customer_id = $1`,
      [customer.id, [...ACTIVE_SUBSCRIPTION_STATUSES], requirePolarProduct()],
    );

    await client.query(
      `UPDATE brava_webhook_events
          SET status = 'processed', processed_at = now(), last_error = NULL
        WHERE provider = 'polar' AND provider_event_id = $1`,
      [eventId],
    );
    await client.query("COMMIT");
    return { duplicate: false, customerId: customer.id, authUserId, activeSubscriptions: customer.activeSubscriptions.length };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
