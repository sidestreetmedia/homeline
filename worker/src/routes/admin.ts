import type { Agent } from '../env';
import { all, one, run } from '../lib/db';
import { hashPassword } from '../lib/password';
import { adminConfigView, adminIndexView, CONFIG_GROUPS, CONFIG_MASK, resetPasswordView, type AdminTotals } from '../views/admin';
import { csrfFailed, field, getConfig, readForm, redirectWith, render, requireGod, type App } from './helpers';

export function registerAdminRoutes(app: App): void {
  app.get('/admin', async (c) => {
    const me = await requireGod(c);
    if (me instanceof Response) return me;
    const agents = await all<Agent & { homes: number }>(
      c.env.DB,
      `SELECT a.*, (SELECT COUNT(*) FROM listings l
                    WHERE l.agent_id = a.id AND l.deleted_at IS NULL AND l.billing_state <> 'provisioning') AS homes
       FROM agents a ORDER BY a.created_at DESC, a.id DESC`,
    );
    const totals = (await one<AdminTotals>(
      c.env.DB,
      `SELECT (SELECT COUNT(*) FROM agents WHERE is_god = 0) AS agents,
              (SELECT COUNT(*) FROM listings WHERE deleted_at IS NULL AND billing_state <> 'provisioning') AS homes,
              (SELECT COUNT(*) FROM call_events WHERE event_type = 'call') AS calls,
              (SELECT COUNT(*) FROM call_events WHERE event_type = 'press1_sms') AS texts`,
    ))!;
    return render(
      c,
      'God Mode — HomeLine',
      adminIndexView({
        agents,
        totals,
        priceCents: (await getConfig(c)).priceCents(),
        csrf: c.get('session').csrfToken(),
        flashOk: c.req.query('ok'),
      }),
    );
  });

  app.post('/admin/agent_action', async (c) => {
    const me = await requireGod(c);
    if (me instanceof Response) return me;
    const form = await readForm(c);
    if (!c.get('session').csrfValid(form.csrf)) return csrfFailed(c);
    const agent = await one<Agent>(c.env.DB, 'SELECT * FROM agents WHERE id = ? AND is_god = 0', parseInt(field(form, 'agent_id'), 10) || 0);
    if (!agent) return c.redirect('/admin');
    const action = field(form, 'action');
    let message = '';
    if (action === 'suspend') {
      await run(c.env.DB, `UPDATE agents SET status = 'suspended', updated_at = datetime('now') WHERE id = ?`, agent.id);
      message = 'Agent suspended.';
    } else if (action === 'activate') {
      await run(c.env.DB, `UPDATE agents SET status = 'active', updated_at = datetime('now') WHERE id = ?`, agent.id);
      message = 'Agent reactivated.';
    }
    return redirectWith(c, '/admin', 'ok', message);
  });

  app.get('/admin/config', async (c) => {
    const me = await requireGod(c);
    if (me instanceof Response) return me;
    const config = await getConfig(c);
    const values: Record<string, string> = {};
    for (const keys of Object.values(CONFIG_GROUPS)) for (const k of Object.keys(keys)) values[k] = config.get(k);
    return render(
      c,
      'Config — God Mode',
      adminConfigView({
        values,
        missing: config.missingKeys(),
        encrypted: config.encryptionAvailable,
        csrf: c.get('session').csrfToken(),
        saved: c.req.query('ok') === '1',
      }),
    );
  });

  app.post('/admin/config', async (c) => {
    const me = await requireGod(c);
    if (me instanceof Response) return me;
    const form = await readForm(c);
    if (!c.get('session').csrfValid(form.csrf)) return csrfFailed(c);
    const config = await getConfig(c);
    for (const keys of Object.values(CONFIG_GROUPS)) {
      for (const k of Object.keys(keys)) {
        if (field(form, `clear_${k}`) === '1') {
          await config.clear(k);
          continue;
        }
        const value = field(form, k);
        if (value === '' || value === CONFIG_MASK) continue; // blank or masked = keep current
        if (value === config.get(k)) continue;
        await config.set(k, value);
      }
    }
    return c.redirect('/admin/config?ok=1');
  });

  const resetTarget = (db: D1Database, id: number) =>
    one<Pick<Agent, 'id' | 'email' | 'full_name'>>(db, 'SELECT id, email, full_name FROM agents WHERE id = ?', id);

  app.get('/admin/reset_password', async (c) => {
    const me = await requireGod(c);
    if (me instanceof Response) return me;
    const agent = await resetTarget(c.env.DB, parseInt(c.req.query('agent_id') ?? '', 10) || 0);
    if (!agent) return c.redirect('/admin');
    return render(c, 'Reset password — God Mode', resetPasswordView({ agent, csrf: c.get('session').csrfToken() }));
  });

  app.post('/admin/reset_password', async (c) => {
    const me = await requireGod(c);
    if (me instanceof Response) return me;
    const form = await readForm(c);
    const session = c.get('session');
    if (!session.csrfValid(form.csrf)) return csrfFailed(c);
    const agent = await resetTarget(c.env.DB, parseInt(field(form, 'agent_id'), 10) || 0);
    if (!agent) return c.redirect('/admin');
    const password = typeof form.password === 'string' ? form.password : '';
    const confirmation = typeof form.password_confirmation === 'string' ? form.password_confirmation : '';
    const fail = (error: string) => render(c, 'Reset password — God Mode', resetPasswordView({ agent, csrf: session.csrfToken(), error }));
    if (password.length < 12) return fail('Use at least 12 characters.');
    if (password !== confirmation) return fail('The passwords do not match.');

    // Bumping session_epoch signs the agent out everywhere (replaces deleting their session rows).
    await run(
      c.env.DB,
      `UPDATE agents SET password_hash = ?, session_epoch = session_epoch + 1, updated_at = datetime('now') WHERE id = ?`,
      await hashPassword(password),
      agent.id,
    );
    if (agent.id === me.id) {
      session.data.epoch = me.session_epoch + 1;
      session.dirty = true;
    }
    return redirectWith(c, '/admin', 'ok', `Password reset for ${agent.full_name}.`);
  });
}
