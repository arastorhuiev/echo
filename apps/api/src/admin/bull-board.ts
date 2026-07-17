import { createBullBoard } from "@bull-board/api"
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter"
import { FastifyAdapter as BullBoardFastifyAdapter } from "@bull-board/fastify"
import type { Queue } from "bullmq"
import type { FastifyInstance } from "fastify"
import { basicAuthValid } from "@/admin/admin-auth"

/** Base path the Bull-Board UI is served under. */
export const BULL_BOARD_BASE_PATH = "/admin/queues"

/**
 * Mount the Bull-Board queue dashboard on the RAW Fastify instance (P13,
 * D3) — it lives outside Nest routing, so a Nest guard can't protect it.
 *
 * Auth is an `onRequest` hook enforcing HTTP Basic against `ADMIN_TOKEN`
 * (browsers send Basic natively), constant-time. Crucially the hook is
 * registered INSIDE the plugin's encapsulated scope (same `{ prefix }`),
 * so it fires for exactly the requests Fastify's router dispatches to
 * Bull-Board — i.e. against the DECODED path. A root-level hook matching
 * the raw `req.url` would be bypassable with a percent-encoded path
 * (`/admin/%71ueues/...` decodes to `/admin/queues/...` and routes in, but
 * `req.url.startsWith("/admin/queues")` would miss and skip auth).
 *
 * Queues are the per-provider producer queues from the (already
 * initialised) QueueRouter.
 */
export async function mountBullBoard(
  fastify: FastifyInstance,
  queues: Queue[],
  adminToken: string,
): Promise<void> {
  const serverAdapter = new BullBoardFastifyAdapter()
  createBullBoard({ queues: queues.map((q) => new BullMQAdapter(q)), serverAdapter })
  serverAdapter.setBasePath(BULL_BOARD_BASE_PATH)

  await fastify.register(
    async (scope) => {
      scope.addHook("onRequest", async (req, reply) => {
        if (!basicAuthValid(req.headers.authorization, adminToken)) {
          await reply
            .header("WWW-Authenticate", 'Basic realm="echo-admin"')
            .code(401)
            .send({ error: "AdminUnauthorized" })
        }
      })
      await scope.register(serverAdapter.registerPlugin())
    },
    { prefix: BULL_BOARD_BASE_PATH },
  )
}
