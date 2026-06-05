<?php
/** @var array $me */
/** @var array $listings */
/** @var int $activeCount */
?>
<div class="stat-grid">
    <div class="stat glass"><div class="n"><?= (int)$activeCount ?></div><div class="l">Active homes</div></div>
    <div class="stat glass"><div class="n">$<?= number_format($activeCount * 5) ?></div><div class="l">Per month</div></div>
    <div class="stat glass"><div class="n"><?= e(date('M j')) ?></div><div class="l">Next bill: 1st</div></div>
</div>

<div class="card glass">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:20px">
        <div>
            <h2 style="margin:0">Your listings</h2>
            <p class="sub" style="margin:4px 0 0">Sorted by address. Each home has its own phone number.</p>
        </div>
        <a class="btn btn-primary" href="<?= !empty($hasCard) ? '/listing_edit.php' : '/billing.php' ?>">+ Add a home</a>
    </div>

    <?php if (!empty($flash_ok)): ?><div class="flash ok"><?= e($flash_ok) ?></div><?php endif; ?>

    <?php if (empty($hasCard)): ?>
        <div class="flash err" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
            <span>Add a card on file before publishing a home.</span>
            <a class="btn btn-sm btn-primary" href="/billing.php">Add a card</a>
        </div>
    <?php endif; ?>

    <?php if (empty($listings)): ?>
        <div class="empty">No homes yet. Add your first listing to get a phone number.</div>
    <?php else: ?>
        <?php foreach ($listings as $l): ?>
            <div class="listing">
                <div>
                    <div class="addr"><?= e($l['address_line1']) ?><?= $l['address_line2'] ? ', ' . e($l['address_line2']) : '' ?></div>
                    <div class="meta">
                        <span><?= e($l['city']) ?>, <?= e($l['state']) ?> <?= e($l['postal_code']) ?></span>
                        <?php if ($l['twilio_number']): ?>
                            <span class="pill num"><?= e($l['twilio_number']) ?></span>
                        <?php endif; ?>
                        <span class="pill <?= e($l['audio_status']) ?>"><?= e(ucfirst($l['audio_status'])) ?> audio</span>
                    </div>
                </div>
                <div style="display:flex;gap:8px">
                    <a class="btn btn-sm btn-ghost" href="/listing_edit.php?id=<?= (int)$l['id'] ?>">Edit</a>
                    <form method="post" action="/listing_delete.php" onsubmit="return confirm('Delete this home? The phone number will be released. You are still billed for the current month.');">
                        <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
                        <input type="hidden" name="id" value="<?= (int)$l['id'] ?>">
                        <button class="btn btn-sm btn-danger" type="submit">Delete</button>
                    </form>
                </div>
            </div>
        <?php endforeach; ?>
    <?php endif; ?>
</div>
