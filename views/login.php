<div class="card auth-card">
    <p class="eyebrow">Agent access</p>
    <h2>Welcome back</h2>
    <p class="sub">Sign in to manage your listings.</p>
    <?php if (!empty($error)): ?><div class="flash err"><?= e($error) ?></div><?php endif; ?>
    <form method="post" action="/login.php">
        <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
        <div class="field"><label>Email or username</label>
            <input class="input" type="text" name="email" autocapitalize="none" autocomplete="username" required></div>
        <div class="field"><label>Password</label>
            <input class="input" type="password" name="password" required></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Sign in</button>
    </form>
    <p class="muted" style="margin-top:16px;text-align:center">
        New here? <a class="link" href="/signup.php">Create an account</a>
    </p>
</div>
