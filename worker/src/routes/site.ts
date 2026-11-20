import type { Agent } from '../env';
import { timingSafeEqual } from '../lib/bytes';
import { one, run } from '../lib/db';
import { hashPassword, verifyPassword } from '../lib/password';
import { currentAgent } from '../lib/session';
import { isEmail } from '../services/aws';
import { Billing } from '../services/billing';
import { homeView, loginView, setupView, signupView } from '../views/site';
import { csrfFailed, field, getConfig, readForm, render, type App } from './helpers';

// Verified against when the account doesn't exist, so response time doesn't reveal which emails are registered.
const DUMMY_HASH = 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function registerSiteRoutes(app: App): void {
  app.get('/', async (c) => {
    if (await currentAgent(c)) return c.redirect('/dashboard');
    return render(c, 'HomeLine — listings that talk', homeView());
  });

  app.get('/login', (c) => render(c, 'Sign in — HomeLine', loginView(c.get('session').csrfToken())));

  app.post('/login', async (c) => {
    const session = c.get('session');
    const form = await readForm(c);
    if (!session.csrfValid(form.csrf)) {
      session.resetCsrf();
      return render(c, 'Sign in — HomeLine', loginView(session.csrfToken(), 'Your sign-in session was refreshed. Please try once more.'));
    }
    const email = field(form, 'email').toLowerCase();
    const password = typeof form.password === 'string' ? form.password : '';
    const agent = await one<Agent>(c.env.DB, 'SELECT * FROM agents WHERE email = ?', email);
    const valid = await verifyPassword(password, agent?.password_hash ?? DUMMY_HASH);
    if (!agent || !valid || agent.status === 'suspended') {
      return render(c, 'Sign in — HomeLine', loginView(session.csrfToken(), 'Incorrect email or password.'));
    }
    session.login(agent);
    return c.redirect(agent.is_god ? '/admin' : '/dashboard');
  });

  app.get('/signup', (c) => render(c, 'Sign up — HomeLine', signupView(c.get('session').csrfToken())));

  app.post('/signup', async (c) => {
    const session = c.get('session');
    const form = await readForm(c);
    if (!session.csrfValid(form.csrf)) return csrfFailed(c);
    const old = { full_name: field(form, 'full_name'), company: field(form, 'company'), email: field(form, 'email') };
    const fail = (message: string) => render(c, 'Sign up — HomeLine', signupView(session.csrfToken(), message, old));

    const email = old.email.toLowerCase();
    const password = typeof form.password === 'string' ? form.password : '';
    if (!old.full_name) return fail('Please enter your name.');
    if (!isEmail(email)) return fail('Please enter a valid email address.');
    if (password.length < 8) return fail('Password must be at least 8 characters.');
    if (await one(c.env.DB, 'SELECT id FROM agents WHERE email = ?', email)) {
      return fail('An account with that email already exists.');
    }
    try {
      await run(
        c.env.DB,
        `INSERT INTO agents (email, password_hash, full_name, company, status) VALUES (?, ?, ?, ?, 'active')`,
        email,
        await hashPassword(password),
        old.full_name,
        old.company || null,
      );
    } catch {
      return fail('An account with that email already exists.');
    }
    const agent = (await one<Agent>(c.env.DB, 'SELECT * FROM agents WHERE email = ?', email))!;
    session.login(agent);

    // Create the Stripe customer now so the card step is ready; non-fatal if billing isn't configured yet.
    try {
      await new Billing(c.env, await getConfig(c)).ensureCustomer(agent);
    } catch (err) {
      console.error(`Stripe customer setup deferred: ${(err as Error).message}`);
    }
    return c.redirect('/billing');
  });

  app.get('/logout', (c) => {
    c.get('session').logout();
    return c.redirect('/');
  });

  /* First-run God Mode account: replaces sql/seed_god.sql and cron/make_god.php. */
  const godExists = async (db: D1Database) => !!(await one(db, 'SELECT id FROM agents WHERE is_god = 1 LIMIT 1'));

  app.get('/setup', async (c) => {
    if (!c.env.SETUP_TOKEN || (await godExists(c.env.DB))) return c.notFound();
    return render(c, 'Setup — HomeLine', setupView(c.get('session').csrfToken()));
  });

  app.post('/setup', async (c) => {
    if (!c.env.SETUP_TOKEN || (await godExists(c.env.DB))) return c.notFound();
    const session = c.get('session');
    const form = await readForm(c);
    if (!session.csrfValid(form.csrf)) return csrfFailed(c);
    const old = { full_name: field(form, 'full_name'), email: field(form, 'email') };
    const fail = (message: string) => render(c, 'Setup — HomeLine', setupView(session.csrfToken(), message, old));

    if (!timingSafeEqual(field(form, 'token'), c.env.SETUP_TOKEN)) return fail('That setup token is not correct.');
    const login = old.email.toLowerCase();
    const password = typeof form.password === 'string' ? form.password : '';
    if (!old.full_name || !login) return fail('Please complete all fields.');
    if (password.length < 12) return fail('Use at least 12 characters.');

    const hash = await hashPassword(password);
    const existing = await one<Agent>(c.env.DB, 'SELECT * FROM agents WHERE email = ?', login);
    if (existing) {
      await run(
        c.env.DB,
        `UPDATE agents SET password_hash = ?, is_god = 1, status = 'active', session_epoch = session_epoch + 1, updated_at = datetime('now') WHERE id = ?`,
        hash,
        existing.id,
      );
    } else {
      await run(
        c.env.DB,
        `INSERT INTO agents (email, password_hash, full_name, status, is_god) VALUES (?, ?, ?, 'active', 1)`,
        login,
        hash,
        old.full_name,
      );
    }
    const agent = (await one<Agent>(c.env.DB, 'SELECT * FROM agents WHERE email = ?', login))!;
    session.login(agent);
    return c.redirect('/admin/config');
  });
}
