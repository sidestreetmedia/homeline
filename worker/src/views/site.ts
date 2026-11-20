import { html, type Html } from './layout';

export function homeView(): Html {
  return html`<section class="hero">
    <div>
        <p class="eyebrow">Real estate voice lines · Built for every drive-by</p>
        <h1>Your listings<br><em>have more</em><br>to say.</h1>
    </div>
    <div class="hero-bottom">
        <p class="lede">One local number. A polished spoken tour. Property details sent by text the moment a caller presses 1.</p>
        <a class="btn btn-primary" href="/signup">Publish a home <span aria-hidden="true">↗</span></a>
    </div>
</section>
<section class="statement">
    <p class="eyebrow">Simple on the sign. Powerful behind it.</p>
    <h2>Every drive-by can become a direct conversation.</h2>
</section>
<section class="feature-list">
    <p class="eyebrow">How HomeLine works</p>
    <div class="feature-row">
        <span class="feature-index">01</span>
        <h3>Choose the line</h3>
        <p>Search available numbers by area code and assign one local voice-and-text line to the property.</p>
    </div>
    <div class="feature-row">
        <span class="feature-index">02</span>
        <h3>Tell the story</h3>
        <p>Write the listing description for a natural spoken narration, or upload the agent’s own finished MP3.</p>
    </div>
    <div class="feature-row">
        <span class="feature-index">03</span>
        <h3>Capture intent</h3>
        <p>Callers hear the tour and press 1 for the property details. HomeLine sends the message immediately from the listing’s number.</p>
    </div>
</section>`;
}

export function loginView(csrf: string, error?: string): Html {
  return html`<div class="card auth-card">
    <p class="eyebrow">Agent access</p>
    <h2>Welcome back</h2>
    <p class="sub">Sign in to manage your listings.</p>
    ${error ? html`<div class="flash err">${error}</div>` : ''}
    <form method="post" action="/login">
        <input type="hidden" name="csrf" value="${csrf}">
        <div class="field"><label>Email or username</label>
            <input class="input" type="text" name="email" autocapitalize="none" autocomplete="username" required></div>
        <div class="field"><label>Password</label>
            <input class="input" type="password" name="password" autocomplete="current-password" required></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Sign in</button>
    </form>
    <p class="muted" style="margin-top:16px;text-align:center">
        New here? <a class="link" href="/signup">Create an account</a>
    </p>
</div>`;
}

export function signupView(csrf: string, error?: string, old: Record<string, string> = {}): Html {
  return html`<div class="card auth-card">
    <p class="eyebrow">Start with one home</p>
    <h2>Create your account</h2>
    <p class="sub">Add your payment method next. You're only billed $5 when you publish a home.</p>
    ${error ? html`<div class="flash err">${error}</div>` : ''}
    <form method="post" action="/signup">
        <input type="hidden" name="csrf" value="${csrf}">
        <div class="field"><label>Full name</label>
            <input class="input" name="full_name" required value="${old.full_name ?? ''}"></div>
        <div class="field"><label>Company (optional)</label>
            <input class="input" name="company" value="${old.company ?? ''}"></div>
        <div class="field"><label>Email</label>
            <input class="input" type="email" name="email" required value="${old.email ?? ''}"></div>
        <div class="field"><label>Password</label>
            <input class="input" type="password" name="password" autocomplete="new-password" required minlength="8"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Continue</button>
    </form>
    <p class="muted" style="margin-top:16px;text-align:center">
        Already have an account? <a class="link" href="/login">Sign in</a>
    </p>
</div>`;
}

export function setupView(csrf: string, error?: string, old: Record<string, string> = {}): Html {
  return html`<div class="card auth-card">
    <p class="eyebrow">First-run setup</p>
    <h2>Create the God Mode account</h2>
    <p class="sub">This page works once, while no God Mode account exists, and only with the setup token stored as a Worker secret.</p>
    ${error ? html`<div class="flash err">${error}</div>` : ''}
    <form method="post" action="/setup">
        <input type="hidden" name="csrf" value="${csrf}">
        <div class="field"><label>Setup token</label>
            <input class="input" type="password" name="token" autocomplete="off" required></div>
        <div class="field"><label>Full name</label>
            <input class="input" name="full_name" required value="${old.full_name ?? ''}"></div>
        <div class="field"><label>Login (email or username)</label>
            <input class="input" name="email" autocapitalize="none" required value="${old.email ?? ''}"></div>
        <div class="field"><label>Password (12+ characters)</label>
            <input class="input" type="password" name="password" autocomplete="new-password" required minlength="12"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Create account</button>
    </form>
</div>`;
}
