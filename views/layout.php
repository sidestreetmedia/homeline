<?php
/** @var string $content */
/** @var string $title */
$me = Auth::current();
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#07131c">
<title><?= e($title) ?></title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<header class="site-header">
    <div class="topbar">
        <a class="brand" href="<?= $me ? '/dashboard.php' : '/' ?>">
            <img src="/assets/sidestreet-wordmark-white.png" alt="Sidestreet Media">
            <span class="brand-product">HomeLine</span>
        </a>
        <nav class="nav" aria-label="Primary navigation">
            <?php if ($me): ?>
                <a class="btn btn-sm btn-ghost" href="/dashboard.php">Listings</a>
                <a class="btn btn-sm btn-ghost" href="/billing.php">Billing</a>
                <?php if ((int)$me['is_god'] === 1): ?>
                    <a class="btn btn-sm btn-ghost" href="/admin/index.php">God Mode</a>
                <?php endif; ?>
                <a class="btn btn-sm" href="/logout.php">Sign out</a>
            <?php else: ?>
                <a class="btn btn-sm btn-ghost" href="/login.php">Sign in</a>
                <a class="btn btn-sm btn-primary" href="/signup.php">Get started</a>
            <?php endif; ?>
        </nav>
    </div>
</header>
<div class="wrap">
    <main class="fade-up"><?= $content ?></main>
</div>
<footer class="site-footer">
    <div class="footer-inner">
        <span>HomeLine by Sidestreet Media</span>
        <span>Listings that talk.</span>
    </div>
</footer>
</body>
</html>
