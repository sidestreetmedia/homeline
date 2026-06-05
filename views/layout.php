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
<title><?= e($title) ?></title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div class="grain"></div>
<div class="wrap">
    <div class="topbar glass">
        <a class="brand" href="<?= $me ? '/dashboard.php' : '/' ?>" style="text-decoration:none;color:inherit">
            <span class="dot"></span> HomeLine
        </a>
        <nav class="nav">
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
    <main class="fade-up"><?= $content ?></main>
</div>
</body>
</html>
