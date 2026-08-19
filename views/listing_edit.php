<?php
/** @var ?array $listing */
/** @var array $me */
$isNew = empty($listing);
$smsMax = 280;
?>
<div class="card narrow">
    <p class="eyebrow"><?= $isNew ? 'New listing' : 'Listing details' ?></p>
    <h2><?= $isNew ? 'Add a home' : 'Edit home' ?></h2>
    <p class="sub">
        <?php if ($isNew): ?>
            When you save, we provision a phone number and bill the first month ($5) immediately.
        <?php else: ?>
            Update details below. Changing the description regenerates the narration.
        <?php endif; ?>
    </p>

    <?php if (!empty($error)): ?><div class="flash err"><?= e($error) ?></div><?php endif; ?>

    <form method="post" action="/listing_save.php" id="listingForm">
        <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
        <?php if (!$isNew): ?><input type="hidden" name="id" value="<?= (int)$listing['id'] ?>"><?php endif; ?>

        <div class="field"><label>Street address</label>
            <input class="input" name="address_line1" required value="<?= e($listing['address_line1'] ?? '') ?>"></div>
        <div class="field"><label>Unit / line 2 (optional)</label>
            <input class="input" name="address_line2" value="<?= e($listing['address_line2'] ?? '') ?>"></div>
        <div class="row cols-3">
            <div class="field"><label>City</label>
                <input class="input" name="city" required value="<?= e($listing['city'] ?? '') ?>"></div>
            <div class="field"><label>State</label>
                <input class="input" name="state" required maxlength="2" value="<?= e($listing['state'] ?? '') ?>"></div>
            <div class="field"><label>ZIP</label>
                <input class="input" name="postal_code" required value="<?= e($listing['postal_code'] ?? '') ?>"></div>
        </div>

        <hr class="form-rule">

        <div class="field">
            <label>Audio source</label>
            <select class="input" name="audio_source" id="audioSource">
                <option value="tts" <?= (($listing['audio_source'] ?? 'tts')==='tts')?'selected':'' ?>>Generate narration from text</option>
                <option value="upload" <?= (($listing['audio_source'] ?? '')==='upload')?'selected':'' ?>>I'll upload a recording</option>
            </select>
        </div>

        <div class="field" id="ttsField">
            <label>Spoken description (what callers will hear)</label>
            <textarea class="input" name="description_text" rows="5"><?= e($listing['description_text'] ?? '') ?></textarea>
        </div>

        <div class="field" id="uploadField" style="display:none">
            <label>Upload recording (MP3)</label>
            <?php if ($isNew): ?>
                <p class="muted">Save the listing first, then return here to upload your MP3.</p>
            <?php else: ?>
                <p class="muted">Upload an MP3 (max 15 MB). This replaces any existing audio.</p>
            <?php endif; ?>
        </div>

        <hr class="form-rule">

        <div class="field">
            <label>Press-1 text message (sent to callers)</label>
            <textarea class="input" name="sms_blurb" id="smsBlurb" maxlength="<?= $smsMax ?>" rows="3" required><?= e($listing['sms_blurb'] ?? '') ?></textarea>
            <div class="counter"><span id="smsCount">0</span>/<?= $smsMax ?></div>
        </div>

        <?php if ($isNew): ?>
        <div class="field">
            <label>Choose a local number — area code</label>
            <div style="display:flex;gap:10px">
                <input class="input" id="areaCode" placeholder="e.g. 864" maxlength="3" style="max-width:140px">
                <button type="button" class="btn" id="searchBtn">Search numbers</button>
            </div>
            <div id="numberResults" style="margin-top:14px"></div>
            <input type="hidden" name="chosen_number" id="chosenNumber" required>
        </div>
        <?php endif; ?>

        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" type="submit">
            <?= $isNew ? 'Save & provision number ($5 now)' : 'Save changes' ?>
        </button>
    </form>
</div>

<?php if (!$isNew): ?>
<div class="card narrow">
    <h2 style="font-size:18px">Upload a recording</h2>
    <p class="sub">Optional — use your own MP3 instead of generated narration.</p>
    <form method="post" action="/audio_upload.php" enctype="multipart/form-data">
        <input type="hidden" name="csrf" value="<?= e(Auth::csrfToken()) ?>">
        <input type="hidden" name="id" value="<?= (int)$listing['id'] ?>">
        <div class="field">
            <input class="input" type="file" name="audio" accept="audio/mpeg,.mp3" required>
        </div>
        <button class="btn" type="submit">Upload MP3</button>
    </form>
</div>
<?php endif; ?>

<script>
const src = document.getElementById('audioSource');
const ttsField = document.getElementById('ttsField');
const uploadField = document.getElementById('uploadField');
function toggleAudio() {
    const up = src.value === 'upload';
    uploadField.style.display = up ? 'block' : 'none';
    ttsField.style.display = up ? 'none' : 'block';
}
src.addEventListener('change', toggleAudio); toggleAudio();

const sms = document.getElementById('smsBlurb');
const cnt = document.getElementById('smsCount');
function upd() { cnt.textContent = sms.value.length; }
sms.addEventListener('input', upd); upd();

<?php if ($isNew): ?>
const searchBtn = document.getElementById('searchBtn');
const results = document.getElementById('numberResults');
const chosen = document.getElementById('chosenNumber');
searchBtn.addEventListener('click', async () => {
    const ac = document.getElementById('areaCode').value.trim();
    if (!/^\d{3}$/.test(ac)) { results.innerHTML = '<p class="muted">Enter a 3-digit area code.</p>'; return; }
    results.innerHTML = '<p class="muted">Searching…</p>';
    try {
        const r = await fetch('/numbers_search.php?area=' + ac);
        const data = await r.json();
        if (!data.ok) { results.innerHTML = '<p class="muted">' + (data.error||'No numbers found.') + '</p>'; return; }
        results.innerHTML = data.numbers.map(n =>
            '<div class="num-pick"><span style="font-variant-numeric:tabular-nums">' + n.phone +
            (n.locality ? ' · <span class="muted">'+n.locality+'</span>' : '') +
            '</span><button type="button" class="btn btn-sm" data-num="'+n.phone+'">Choose</button></div>'
        ).join('');
        results.querySelectorAll('button[data-num]').forEach(b => b.addEventListener('click', () => {
            chosen.value = b.dataset.num;
            results.querySelectorAll('.num-pick').forEach(x => x.style.opacity = .4);
            b.closest('.num-pick').style.opacity = 1;
            b.textContent = 'Selected ✓';
        }));
    } catch(e) { results.innerHTML = '<p class="muted">Search failed.</p>'; }
});
<?php endif; ?>
</script>
