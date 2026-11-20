import { Hono } from 'hono';
import type { Agent, Env } from './env';
import { Config, ConfigMissingError } from './lib/config';
import { all, run } from './lib/db';
import { sessionMiddleware, type AppVars } from './lib/session';
import { registerAdminRoutes } from './routes/admin';
import { registerAppRoutes } from './routes/app';
import { registerSiteRoutes } from './routes/site';
import { registerWebhookRoutes } from './routes/webhooks';
import { Billing } from './services/billing';
import { consumeBatch, type Job } from './services/jobs';
import { notConfiguredPage } from './views/layout';

const app = new Hono<{ Bindings: Env; Variables: AppVars }>();

const WEBHOOK_PATHS = new Set(['/telnyx_voice', '/telnyx_gather', '/telnyx_messaging', '/telnyx_status', '/stripe_webhook']);

app.use('*', async (c, next) => {
  if (WEBHOOK_PATHS.has(c.req.path)) return next();
  await sessionMiddleware(c, async () => {
    await next();
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('Cache-Control', 'no-store');
  });
});

registerWebhookRoutes(app);
registerSiteRoutes(app);
registerAppRoutes(app);
registerAdminRoutes(app);

app.get('/up', (c) => c.text('ok'));

app.onError((err, c) => {
  if (err instanceof ConfigMissingError) {
    console.error(`Config missing: ${err.configKey}`);
    if (c.req.path === '/numbers_search') return c.json({ ok: false, error: 'This feature is not configured yet.' }, 503);
    if (WEBHOOK_PATHS.has(c.req.path)) return c.text('Not configured', 503);
    return c.html(notConfiguredPage(), 503);
  }
  console.error(`Unhandled: ${err.stack ?? err.message}`);
  return c.text('An unexpected error occurred.', 500);
});

/**
 * Monthly maintenance (06:00 UTC on the 1st, after Stripe has renewed):
 * homes that skipped this renewal under the grace rule rejoin the count for the next one.
 */
async function monthlyMaintenance(env: Env): Promise<void> {
  const agents = await all<Agent>(
    env.DB,
    `SELECT * FROM agents WHERE id IN (SELECT DISTINCT agent_id FROM listings WHERE skip_next_recurring = 1 AND deleted_at IS NULL)`,
  );
  await run(env.DB, `UPDATE listings SET skip_next_recurring = 0, updated_at = datetime('now') WHERE skip_next_recurring = 1 AND deleted_at IS NULL`);
  // Rows abandoned mid-publish (the request died between steps) are never visible; clear them out.
  await run(env.DB, `DELETE FROM listings WHERE billing_state = 'provisioning' AND created_at < datetime('now', '-1 day')`);
  if (agents.length === 0) return;
  const billing = new Billing(env, await Config.load(env));
  for (const agent of agents) {
    try {
      await billing.syncQuantity(agent);
    } catch (err) {
      console.error(`grace re-sync for agent ${agent.id}: ${(err as Error).message}`);
    }
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    // The PHP app's URLs keep working (/login.php, /telnyx_voice.php, ...), so anything
    // already pointed at them in Telnyx or Stripe needs no changes.
    const url = new URL(request.url);
    if (url.pathname.endsWith('.php')) {
      let path = url.pathname.slice(0, -4);
      if (path === '/index') path = '/';
      if (path === '/admin/index') path = '/admin';
      url.pathname = path;
      request = new Request(url.toString(), request);
    }
    return app.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<Job>, env: Env): Promise<void> {
    await consumeBatch(batch, env);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(monthlyMaintenance(env));
  },
} satisfies ExportedHandler<Env, Job>;
