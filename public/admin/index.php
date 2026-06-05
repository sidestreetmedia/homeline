<?php
require __DIR__ . '/../../src/bootstrap.php';
$me = Auth::requireGod();

$agents = DB::all(
    "SELECT a.*,
            (SELECT COUNT(*) FROM listings l WHERE l.agent_id=a.id AND l.deleted_at IS NULL) AS homes
     FROM agents a
     ORDER BY a.created_at DESC"
);
$totals = DB::one(
    "SELECT
        (SELECT COUNT(*) FROM agents WHERE is_god=0) AS agents,
        (SELECT COUNT(*) FROM listings WHERE deleted_at IS NULL) AS homes,
        (SELECT COUNT(*) FROM call_events WHERE event_type='call') AS calls,
        (SELECT COUNT(*) FROM call_events WHERE event_type='press1_sms') AS texts"
);
$mrr = ((int)$totals['homes']) * 5;
ob_start();
?>
<div class="stat-grid">
    <div class="stat glass"><div class="n"><?= (int)$totals['agents'] ?></div><div class="l">Agents</div></div>
    <div class="stat glass"><div class="n"><?= (int)$totals['homes'] ?></div><div class="l">Active homes</div></div>
    <div class="stat glass"><div class="n">$<?= number_format($mrr) ?></div><div class="l">MRR</div></div>
    <div class="stat glass"><div class="n"><?= (int)$totals['calls'] ?></div><div class="l">Calls</div></div>
    <div class="stat glass"><div class="n"><?= (int)$totals['texts'] ?></div><div class="l">Press-1 texts</div></div>
</div>

<div class="card glass">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <h2 style="margin:0">Agents</h2>
        <a class="btn btn-sm" href="/admin/config.php">App keys &amp; config</a>
    </div>
    <?php if (!empty($_GET['ok'])): ?><div class="flash ok"><?= e($_GET['ok']) ?></div><?php endif; ?>
    <table class="tbl">
        <thead><tr><th>Agent</th><th>Email</th><th>Homes</th><th>Status</th><th>Stripe</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($agents as $a): ?>
            <tr>
                <td><?= e($a['full_name']) ?><?= $a['is_god'] ? ' <span class="pill num">god</span>' : '' ?>
                    <?php if ($a['company']): ?><div class="muted"><?= e($a['company']) ?></div><?php endif; ?></td>
                <td class="muted"><?= e($a['email']) ?></td>
                <td><?= (int)$a['homes'] ?></td>
                <td>
                    <span class="pill <?= $a['status']==='active'?'ready':($a['status']==='suspended'?'failed':'pending') ?>">
                        <?= e(ucfirst($a['status'])) ?>
                    </span>
                </td>
                <td class="muted" style="font-size:12px"><?= e($a['stripe_customer_id'] ?: '—') ?></td>
                <td style="text-align:right">
                    <?php if (!$a['is_god']): ?>
                    <form method="post" action="/admin/agent_action.php" style="display:inline">
                        <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
                        <input type="hidden" name="agent_id" value="<?= (int)$a['id'] ?>">
                        <?php if ($a['status'] === 'suspended'): ?>
                            <button class="btn btn-sm" name="action" value="activate">Reactivate</button>
                        <?php else: ?>
                            <button class="btn btn-sm btn-danger" name="action" value="suspend">Suspend</button>
                        <?php endif; ?>
                    </form>
                    <?php endif; ?>
                </td>
            </tr>
        <?php endforeach; ?>
        </tbody>
    </table>
</div>
<?php
$content = ob_get_clean();
$title = 'God Mode — HomeLine';
require __DIR__ . '/../../views/layout.php';

