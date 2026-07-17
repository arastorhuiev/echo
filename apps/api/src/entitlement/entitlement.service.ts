import type { AppConfigService } from "@echo/config"
import { repositories } from "@echo/db"
import type { DbClient } from "@echo/db/client"
import { DB_CLIENT } from "@echo/nest"
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common"
import { ConfigService } from "@nestjs/config"

/**
 * The paywall seam (P14). Gates ONLY the public entrypoints
 * (`POST /api/lookups`, `POST /api/search`); orchestration children run via
 * the internal (ungated) path so they never double-gate.
 *
 * `PAYMENTS_ENABLED=false` (default) ⇒ the gate is OPEN: everything is
 * allowed and stamped paid, so results stay testable end-to-end.
 * `=true` ⇒ require a paid entitlement; without one the caller gets 402.
 * The enabled branch reads the reserved `payments` schema (empty until P15),
 * so today it always denies — exactly the behaviour the DoD asserts.
 */
@Injectable()
export class EntitlementService {
  constructor(
    @Inject(DB_CLIENT) private readonly dbClient: DbClient,
    @Inject(ConfigService) private readonly config: AppConfigService,
  ) {}

  paymentsEnabled(): boolean {
    return this.config.get("PAYMENTS_ENABLED")
  }

  /** Throw 402 unless the requester is entitled. No-op when payments are off. */
  async assertEntitled(): Promise<void> {
    if (!this.paymentsEnabled()) return
    if (await repositories.payments.hasSucceededPayment(this.dbClient.db)) return
    throw new HttpException(
      { error: "PaymentRequired", reason: "no active entitlement" },
      HttpStatus.PAYMENT_REQUIRED,
    )
  }
}
