<div class="card auth-card">
    <p class="eyebrow">Start with one home</p>
    <h2>Create your account</h2>
    <p class="sub">Add your payment method next. You're only billed $5 when you publish a home.</p>
    <?php if (!empty($error)): ?><div class="flash err"><?= e($error) ?></div><?php endif; ?>
    <form method="post" action="/signup.php">
        <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
        <div class="field"><label>Full name</label>
            <input class="input" name="full_name" required value="<?= e($old['full_name'] ?? '') ?>"></div>
        <div class="field"><label>Company (optional)</label>
            <input class="input" name="company" value="<?= e($old['company'] ?? '') ?>"></div>
        <div class="field"><label>Email</label>
            <input class="input" type="email" name="email" required value="<?= e($old['email'] ?? '') ?>"></div>
        <div class="field"><label>Password</label>
            <input class="input" type="password" name="password" required minlength="8"></div>
        <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Continue</button>
    </form>
    <p class="muted" style="margin-top:16px;text-align:center">
        Already have an account? <a class="link" href="/login.php">Sign in</a>
    </p>
</div>
