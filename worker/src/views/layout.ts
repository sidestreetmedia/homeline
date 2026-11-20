import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { Agent } from '../env';

export type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export function layout(opts: { title: string; me: Agent | null; content: Html }): Html {
  const { title, me, content } = opts;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#07131c">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="site-header">
    <div class="topbar">
        <a class="brand" href="${me ? '/dashboard' : '/'}">
            <img src="/assets/sidestreet-wordmark-white.png" alt="Sidestreet Media">
            <span class="brand-product">HomeLine</span>
        </a>
        <nav class="nav" aria-label="Primary navigation">
            ${me
              ? html`<a class="btn btn-sm btn-ghost" href="/dashboard">Listings</a>
                <a class="btn btn-sm btn-ghost" href="/billing">Billing</a>
                ${me.is_god ? html`<a class="btn btn-sm btn-ghost" href="/admin">God Mode</a>` : ''}
                <a class="btn btn-sm" href="/logout">Sign out</a>`
              : html`<a class="btn btn-sm btn-ghost" href="/login">Sign in</a>
                <a class="btn btn-sm btn-primary" href="/signup">Get started</a>`}
        </nav>
    </div>
</header>
<div class="wrap">
    <main class="fade-up">${content}</main>
</div>
<footer class="site-footer">
    <div class="footer-inner">
        <span>HomeLine by Sidestreet Media</span>
        <span>Listings that talk.</span>
    </div>
</footer>
</body>
</html>`;
}

export function notConfiguredPage(): Html {
  return html`<!doctype html><meta charset="utf-8"><title>Not configured</title>
<div style="font-family:system-ui;max-width:560px;margin:80px auto;padding:24px;background:#111;color:#eee;border-radius:16px;line-height:1.5">
<h2 style="margin-top:0">This feature isn't configured yet</h2>
<p>An administrator can complete the private connection settings in God Mode under <strong>App keys &amp; config</strong>.</p></div>`;
}

export { html, raw };
