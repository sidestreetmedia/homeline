<?php
require __DIR__ . '/../../src/bootstrap.php';
$me = Auth::requireGod();

$agentId = (int) ($_POST['agent_id'] ?? $_GET['agent_id'] ?? 0);
$agent = DB::one(
    "SELECT id, email, full_name, is_god FROM agents WHERE id=:id",
    [':id' => $agentId]
);
if (!$agent) {
    header('Location: /admin/index.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    Auth::checkCsrf(post('csrf'));
    $password = (string) post('password');
    $confirmation = (string) post('password_confirmation');

    if (strlen($password) < 12) {
        $error = 'Use at least 12 characters.';
    } elseif (!hash_equals($password, $confirmation)) {
        $error = 'The passwords do not match.';
    } else {
        DB::run(
            "UPDATE agents SET password_hash=:password WHERE id=:id",
            [':password' => password_hash($password, PASSWORD_DEFAULT), ':id' => $agentId]
        );
        if ((int) $agentId !== (int) $me['id']) {
            DB::run("DELETE FROM sessions WHERE agent_id=:id", [':id' => $agentId]);
        }
        header('Location: /admin/index.php?ok=' . rawurlencode('Password reset for ' . $agent['full_name'] . '.'));
        exit;
    }
}

ob_start();
?>
<div class="card narrow">
    <p class="eyebrow">God Mode</p>
    <h1>Reset password</h1>
    <p class="muted">Set a new password for <?= e($agent['full_name']) ?> (<?= e($agent['email']) ?>).</p>
    <?php if ($error): ?><div class="flash err"><?= e($error) ?></div><?php endif; ?>
    <form method="post" action="/admin/reset_password.php">
        <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
        <input type="hidden" name="agent_id" value="<?= (int)$agent['id'] ?>">
        <div class="field"><label>New password
            <input class="input" type="password" name="password" minlength="12" autocomplete="new-password" required>
        </label></div>
        <div class="field"><label>Confirm new password
            <input class="input" type="password" name="password_confirmation" minlength="12" autocomplete="new-password" required>
        </label></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn btn-primary" type="submit">Reset password</button>
            <a class="btn" href="/admin/index.php">Cancel</a>
        </div>
    </form>
</div>
<?php
$content = ob_get_clean();
$title = 'Reset password — God Mode';
require __DIR__ . '/../../views/layout.php';
