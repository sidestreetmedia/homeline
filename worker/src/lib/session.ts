import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Agent, Env } from '../env';
import { randomHex, timingSafeEqual } from './bytes';
import { one } from './db';
import type { Config } from './config';

const COOKIE = 'homeline_session';
const TTL_SECONDS = 7 * 86_400;

interface SessionData {
  agentId?: number;
  epoch?: number;
  csrf?: string;
}

export class Session {
  dirty = false;
  destroyed = false;
  previousId: string | null = null;

  constructor(
    public id: string | null,
    public data: SessionData,
  ) {}

  csrfToken(): string {
    if (!this.data.csrf) {
      this.data.csrf = randomHex(32);
      this.dirty = true;
    }
    return this.data.csrf;
  }

  csrfValid(token: unknown): boolean {
    return typeof token === 'string' && token !== '' && !!this.data.csrf && timingSafeEqual(this.data.csrf, token);
  }

  resetCsrf(): void {
    delete this.data.csrf;
    this.dirty = true;
  }

  /** Log in and rotate the session id (fixation defence). */
  login(agent: Agent): void {
    this.previousId = this.id;
    this.id = null;
    this.data = { agentId: agent.id, epoch: agent.session_epoch };
    this.dirty = true;
  }

  logout(): void {
    this.destroyed = true;
  }
}

export type AppVars = { session: Session; config: Config; agent: Agent | null; agentLoaded: boolean };
export type AppContext = Context<{ Bindings: Env; Variables: AppVars }>;

export const sessionMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: AppVars }> = async (c, next) => {
  const cookieId = getCookie(c, COOKIE);
  let session = new Session(null, {});
  if (cookieId && /^[0-9a-f]{64}$/.test(cookieId)) {
    const stored = await c.env.SESSIONS.get<SessionData>(`sess:${cookieId}`, 'json');
    if (stored) session = new Session(cookieId, stored);
  }
  c.set('session', session);
  c.set('agentLoaded', false);
  c.set('agent', null);

  await next();

  const kv = c.env.SESSIONS;
  if (session.destroyed) {
    if (session.id) await kv.delete(`sess:${session.id}`);
    deleteCookie(c, COOKIE, { path: '/' });
    return;
  }
  if (!session.dirty) return;
  if (session.previousId) await kv.delete(`sess:${session.previousId}`);
  if (!session.id) session.id = randomHex(32);
  await kv.put(`sess:${session.id}`, JSON.stringify(session.data), { expirationTtl: TTL_SECONDS });
  setCookie(c, COOKIE, session.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    maxAge: TTL_SECONDS,
  });
};

/** The signed-in agent, or null. Suspended agents and stale sessions read as signed out. */
export async function currentAgent(c: AppContext): Promise<Agent | null> {
  if (c.get('agentLoaded')) return c.get('agent');
  const session = c.get('session');
  let agent: Agent | null = null;
  if (session.data.agentId) {
    agent = await one<Agent>(c.env.DB, 'SELECT * FROM agents WHERE id = ?', session.data.agentId);
    if (agent && (agent.status === 'suspended' || agent.session_epoch !== (session.data.epoch ?? 0))) {
      agent = null;
    }
  }
  c.set('agent', agent);
  c.set('agentLoaded', true);
  return agent;
}
