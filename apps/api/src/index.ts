import { runAggregation } from "./aggregate";
import { app, type Env } from "./app";

export default {
  fetch: app.fetch,
  /** Every 5 minutes (wrangler.jsonc `triggers`): build and publish the snapshot. */
  async scheduled(controller, env, ctx) {
    const now = Math.floor(controller.scheduledTime / 1000);
    ctx.waitUntil(
      runAggregation(env, now).then(
        (r) => console.log(JSON.stringify({ event: "aggregate", now, ...r })),
        (e: unknown) => {
          console.log(JSON.stringify({ event: "aggregate_failed", now, error: String(e) }));
          throw e; // shows as a failed invocation in the Cron Triggers log
        },
      ),
    );
  },
} satisfies ExportedHandler<Env>;
