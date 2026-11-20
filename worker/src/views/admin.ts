import type { Agent } from '../env';
import { html, type Html } from './layout';

const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface AdminTotals {
  agents: number;
  homes: number;
  calls: number;
  texts: number;
}

export function adminIndexView(o: {
  agents: (Agent & { homes: number })[];
  totals: AdminTotals;
  priceCents: number;
  csrf: string;
  flashOk?: string;
}): Html {
  const mrr = Math.round((o.totals.homes * o.priceCents) / 100).toLocaleString('en-US');
  return html`<div class="stat-grid">
    <div class="stat glass"><div class="n">${o.totals.agents}</div><div class="l">Agents</div></div>
    <div class="stat glass"><div class="n">${o.totals.homes}</div><div class="l">Active homes</div></div>
    <div class="stat glass"><div class="n">$${mrr}</div><div class="l">MRR</div></div>
    <div class="stat glass"><div class="n">${o.totals.calls}</div><div class="l">Calls</div></div>
    <div class="stat glass"><div class="n">${o.totals.texts}</div><div class="l">Press-1 texts</div></div>
</div>
<div class="card">
    <div class="section-head">
        <h2 style="margin:0">Agents</h2>
        <a class="btn btn-sm" href="/admin/config">App keys &amp; config</a>
    </div>
    ${o.flashOk ? html`<div class="flash ok">${o.flashOk}</div>` : ''}
    <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Agent</th><th>Email</th><th>Homes</th><th>Status</th><th>Billing ID</th><th></th></tr></thead>
        <tbody>
        ${o.agents.map(
          (a) => html`<tr>
                <td>${a.full_name}${a.is_god ? html` <span class="pill num">god</span>` : ''}
                    ${a.company ? html`<div class="muted">${a.company}</div>` : ''}</td>
                <td class="muted">${a.email}</td>
                <td>${a.homes}</td>
                <td>
                    <span class="pill ${a.status === 'active' ? 'ready' : a.status === 'suspended' ? 'failed' : 'pending'}">${ucfirst(a.status)}</span>
                    ${a.billing_status === 'past_due' ? html`<span class="pill failed">Past due</span>` : ''}
                </td>
                <td class="muted" style="font-size:12px">${a.stripe_customer_id || '—'}</td>
                <td style="text-align:right">
                    <a class="btn btn-sm" href="/admin/reset_password?agent_id=${a.id}">Reset password</a>
                    ${!a.is_god
                      ? html`<form method="post" action="/admin/agent_action" style="display:inline">
                        <input type="hidden" name="csrf" value="${o.csrf}">
                        <input type="hidden" name="agent_id" value="${a.id}">
                        ${a.status === 'suspended'
                          ? html`<button class="btn btn-sm" name="action" value="activate">Reactivate</button>`
                          : html`<button class="btn btn-sm btn-danger" name="action" value="suspend">Suspend</button>`}
                    </form>`
                      : ''}
                </td>
            </tr>`,
        )}
        </tbody>
    </table></div>
</div>`;
}

export const CONFIG_GROUPS: Record<string, Record<string, string>> = {
  Telnyx: {
    TELNYX_API_KEY: 'API key',
    TELNYX_TEXML_APP_ID: 'TeXML application ID',
    TELNYX_MESSAGING_PROFILE_ID: 'Messaging profile ID',
    TELNYX_PUBLIC_KEY: 'Webhook public key',
  },
  ElevenLabs: {
    ELEVENLABS_API_KEY: 'API Key',
    ELEVENLABS_VOICE_ID: 'Default Voice ID',
    ELEVENLABS_MODEL: 'Model (e.g. eleven_turbo_v2_5)',
  },
  Stripe: {
    STRIPE_SECRET_KEY: 'Secret Key',
    STRIPE_PRICE_ID: 'Price ID ($5/mo recurring)',
    STRIPE_WEBHOOK_SECRET: 'Webhook Secret',
    PRICE_CENTS: 'Price in cents (default 500)',
  },
  'AWS S3': {
    AWS_ACCESS_KEY_ID: 'Access Key ID',
    AWS_SECRET_ACCESS_KEY: 'Secret Access Key',
    AWS_REGION: 'Region (e.g. us-east-1)',
    S3_BUCKET: 'Bucket name',
  },
  'AWS SES notifications': {
    AWS_SES_ACCESS_KEY_ID: 'Access key ID',
    AWS_SES_SECRET_ACCESS_KEY: 'Secret access key',
    AWS_SES_SESSION_TOKEN: 'Session token (optional)',
    AWS_SES_REGION: 'Region (e.g. us-east-1)',
    AWS_SES_FROM_EMAIL: 'Verified sender email',
    AWS_SES_FROM_NAME: 'Sender name (default HomeLine)',
    AWS_SES_REPLY_TO_EMAIL: 'Reply-to email (optional)',
    AWS_SES_CONFIGURATION_SET: 'Configuration set (optional)',
  },
  Application: {
    APP_BASE_URL: 'Public base URL (https://…)',
  },
};

export const CONFIG_MASK = '••••••••';
export const isSecretKey = (k: string) => /(ACCESS_KEY_ID|KEY|TOKEN|SECRET)$/.test(k);

export function adminConfigView(o: {
  values: Record<string, string>;
  missing: string[];
  encrypted: boolean;
  csrf: string;
  saved: boolean;
}): Html {
  return html`<div class="card narrow">
    <p class="eyebrow">System configuration</p>
    <h2>App keys &amp; configuration</h2>
    <p class="sub">These are stored in the database and are the source of truth for
       the whole app. Secrets are masked — leave the dots to keep the current
       value, type a new value to replace it, or tick “clear”.</p>
    ${o.saved ? html`<div class="flash ok">Configuration saved.</div>` : ''}
    ${o.encrypted
      ? html`<div class="flash ok">Stored values are encrypted at rest (AES-256-GCM). The master key is a Worker secret, not in the database.</div>`
      : html`<div class="flash err">No <code>CONFIG_ENCRYPTION_KEY</code> secret is set, so values are stored as <strong>plaintext</strong>. Add one (<code>openssl rand -base64 32</code>) and re-save each key to encrypt it.</div>`}
    ${o.missing.length
      ? html`<div class="flash err">Not yet configured: ${o.missing.join(', ')}. The app can't use the related features until these are set.</div>`
      : html`<div class="flash ok">All required keys are configured.</div>`}
    <form method="post" action="/admin/config">
        <input type="hidden" name="csrf" value="${o.csrf}">
        ${Object.entries(CONFIG_GROUPS).map(
          ([section, keys]) => html`<h2 style="font-size:16px;margin:22px 0 10px">${section}</h2>
            ${Object.entries(keys).map(([k, label]) => {
              const value = o.values[k] ?? '';
              const set = value !== '';
              return html`<div class="field">
                    <label>${label} <span class="muted">(${k})</span>
                        ${set
                          ? html`<span class="pill ready" style="margin-left:6px">set</span>`
                          : html`<span class="pill pending" style="margin-left:6px">unset</span>`}
                    </label>
                    <input class="input" name="${k}" value="${set && isSecretKey(k) ? CONFIG_MASK : value}"
                           autocomplete="off" spellcheck="false" placeholder="${set ? '' : 'not configured'}">
                    ${set
                      ? html`<label class="muted" style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;font-size:12px">
                            <input type="checkbox" name="clear_${k}" value="1"> clear this value
                        </label>`
                      : ''}
                </div>`;
            })}`,
        )}
        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" type="submit">Save configuration</button>
    </form>
    <p class="muted" style="margin-top:16px"><a class="link" href="/admin">← Back to agents</a></p>
</div>`;
}

export function resetPasswordView(o: { agent: Pick<Agent, 'id' | 'email' | 'full_name'>; csrf: string; error?: string }): Html {
  return html`<div class="card narrow">
    <p class="eyebrow">God Mode</p>
    <h1>Reset password</h1>
    <p class="muted">Set a new password for ${o.agent.full_name} (${o.agent.email}).</p>
    ${o.error ? html`<div class="flash err">${o.error}</div>` : ''}
    <form method="post" action="/admin/reset_password">
        <input type="hidden" name="csrf" value="${o.csrf}">
        <input type="hidden" name="agent_id" value="${o.agent.id}">
        <div class="field"><label>New password
            <input class="input" type="password" name="password" minlength="12" autocomplete="new-password" required>
        </label></div>
        <div class="field"><label>Confirm new password
            <input class="input" type="password" name="password_confirmation" minlength="12" autocomplete="new-password" required>
        </label></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-primary" type="submit">Reset password</button>
            <a class="btn" href="/admin">Cancel</a>
        </div>
    </form>
</div>`;
}
