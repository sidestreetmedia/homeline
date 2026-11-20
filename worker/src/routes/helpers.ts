import type { Hono } from 'hono';
import type { Agent, Env } from '../env';
import { Config } from '../lib/config';
import { currentAgent, type AppContext, type AppVars } from '../lib/session';
import { layout, type Html } from '../views/layout';

export type App = Hono<{ Bindings: Env; Variables: AppVars }>;

export async function getConfig(c: AppContext): Promise<Config> {
  let config = c.get('config');
  if (!config) {
    config = await Config.load(c.env);
    c.set('config', config);
  }
  return config;
}

export async function render(c: AppContext, title: string, content: Html, status = 200): Promise<Response> {
  const me = await currentAgent(c);
  return c.html(layout({ title, me, content }), status as 200);
}

export type Form = Record<string, string | File>;

export async function readForm(c: AppContext): Promise<Form> {
  return (await c.req.parseBody()) as Form;
}

/** Trimmed string field, or '' when absent. */
export function field(form: Form, key: string): string {
  const v = form[key];
  return typeof v === 'string' ? v.trim() : '';
}

export function csrfFailed(c: AppContext): Response {
  return c.text('CSRF token mismatch.', 419 as 400);
}

export function redirectWith(c: AppContext, path: string, key: 'ok' | 'err', message: string): Response {
  return c.redirect(`${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(message)}`);
}

export async function requireAgent(c: AppContext): Promise<Agent | Response> {
  const me = await currentAgent(c);
  return me ?? c.redirect('/login');
}

export async function requireGod(c: AppContext): Promise<Agent | Response> {
  const me = await currentAgent(c);
  if (!me) return c.redirect('/login');
  if (!me.is_god) return c.text('Forbidden', 403);
  return me;
}
