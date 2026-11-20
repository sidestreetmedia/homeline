import type { Listing } from '../env';
import { html, raw, type Html } from './layout';

const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function dashboardView(o: {
  listings: Listing[];
  activeCount: number;
  priceCents: number;
  nextBill: string;
  hasCard: boolean;
  pastDue: boolean;
  csrf: string;
  flashOk?: string;
}): Html {
  const monthly = Math.round((o.activeCount * o.priceCents) / 100).toLocaleString('en-US');
  return html`<div class="stat-grid">
    <div class="stat glass"><div class="n">${o.activeCount}</div><div class="l">Active homes</div></div>
    <div class="stat glass"><div class="n">$${monthly}</div><div class="l">Per month</div></div>
    <div class="stat glass"><div class="n">${o.nextBill}</div><div class="l">Next bill</div></div>
</div>
<div class="card">
    <div class="section-head">
        <div>
            <h2 style="margin:0">Your listings</h2>
            <p class="sub" style="margin:4px 0 0">Sorted by address. Each home has its own phone number.</p>
        </div>
        <a class="btn btn-primary" href="${o.hasCard && !o.pastDue ? '/listing_edit' : '/billing'}">+ Add a home</a>
    </div>
    ${o.flashOk ? html`<div class="flash ok">${o.flashOk}</div>` : ''}
    ${o.pastDue
      ? html`<div class="flash err" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
            <span>Your last payment didn't go through. Update your card to keep adding homes.</span>
            <a class="btn btn-sm btn-primary" href="/billing">Update card</a>
        </div>`
      : ''}
    ${!o.hasCard
      ? html`<div class="flash err" style="display:flex;align-items:center;justify-content:space-between;gap:14px">
            <span>Add a card on file before publishing a home.</span>
            <a class="btn btn-sm btn-primary" href="/billing">Add a card</a>
        </div>`
      : ''}
    ${o.listings.length === 0
      ? html`<div class="empty">No homes yet. Add your first listing to get a phone number.</div>`
      : o.listings.map(
          (l) => html`<div class="listing">
                <div>
                    <div class="addr">${l.address_line1}${l.address_line2 ? `, ${l.address_line2}` : ''}</div>
                    <div class="meta">
                        <span>${l.city}, ${l.state} ${l.postal_code}</span>
                        ${l.phone_number ? html`<span class="pill num">${l.phone_number}</span>` : ''}
                        <span class="pill ${l.audio_status}">${ucfirst(l.audio_status)} audio</span>
                    </div>
                </div>
                <div class="listing-actions">
                    <a class="btn btn-sm btn-ghost" href="/listing_edit?id=${l.id}">Edit</a>
                    <form method="post" action="/listing_delete" onsubmit="return confirm('Delete this home? The phone number will be released. You are still billed for the current month.');">
                        <input type="hidden" name="csrf" value="${o.csrf}">
                        <input type="hidden" name="id" value="${l.id}">
                        <button class="btn btn-sm btn-danger" type="submit">Delete</button>
                    </form>
                </div>
            </div>`,
        )}
</div>`;
}

export function billingView(o: { hasCard: boolean; pastDue: boolean; cardLabel: string | null; csrf: string; error?: string }): Html {
  return html`<div class="card narrow">
    <p class="eyebrow">Billing</p>
    <h2>Payment method</h2>
    <p class="sub">A card on file is required before you can publish a home. Your
       card is charged $5 the moment you save a home, and $5 per active home on the
       1st of each month.</p>
    ${o.error ? html`<div class="flash err">${o.error}</div>` : ''}
    ${o.pastDue ? html`<div class="flash err">Your last payment didn't go through. Replace the card below and we'll retry the open invoice.</div>` : ''}
    ${o.hasCard
      ? html`<div class="listing" style="margin-bottom:18px">
            <div>
                <div class="addr">Card on file</div>
                <div class="meta">${o.cardLabel ?? 'Saved card'}</div>
            </div>
            <span class="pill ${o.pastDue ? 'failed' : 'ready'}">${o.pastDue ? 'Past due' : 'Active'}</span>
        </div>
        <form method="post" action="/billing">
            <input type="hidden" name="csrf" value="${o.csrf}">
            <button class="btn" type="submit">Replace card</button>
            ${o.pastDue ? '' : html`<a class="btn btn-primary" href="/listing_edit">Add a home</a>`}
        </form>`
      : html`<div class="flash err">No card on file yet.</div>
        <form method="post" action="/billing">
            <input type="hidden" name="csrf" value="${o.csrf}">
            <button class="btn btn-primary" style="width:100%;justify-content:center" type="submit">Add a card</button>
        </form>
        <p class="muted" style="margin-top:12px;text-align:center">You're securely redirected to our payment processor to enter your card. We never see the number.</p>`}
</div>`;
}

const SMS_MAX = 280;

export function listingEditView(o: { listing: Partial<Listing> | null; isNew: boolean; csrf: string; error?: string }): Html {
  const l = o.listing ?? {};
  const isNew = o.isNew;
  const source = l.audio_source ?? 'tts';
  return html`<div class="card narrow">
    <p class="eyebrow">${isNew ? 'New listing' : 'Listing details'}</p>
    <h2>${isNew ? 'Add a home' : 'Edit home'}</h2>
    <p class="sub">${isNew
      ? 'When you save, we provision a phone number and bill the first month ($5) immediately.'
      : 'Update details below. Changing the description regenerates the narration.'}</p>
    ${o.error ? html`<div class="flash err">${o.error}</div>` : ''}
    <form method="post" action="/listing_save" id="listingForm">
        <input type="hidden" name="csrf" value="${o.csrf}">
        ${!isNew ? html`<input type="hidden" name="id" value="${l.id ?? ''}">` : ''}
        <div class="field"><label>Street address</label>
            <input class="input" name="address_line1" required value="${l.address_line1 ?? ''}"></div>
        <div class="field"><label>Unit / line 2 (optional)</label>
            <input class="input" name="address_line2" value="${l.address_line2 ?? ''}"></div>
        <div class="row cols-3">
            <div class="field"><label>City</label>
                <input class="input" name="city" required value="${l.city ?? ''}"></div>
            <div class="field"><label>State</label>
                <input class="input" name="state" required maxlength="2" value="${l.state ?? ''}"></div>
            <div class="field"><label>ZIP</label>
                <input class="input" name="postal_code" required value="${l.postal_code ?? ''}"></div>
        </div>
        <hr class="form-rule">
        <div class="field">
            <label>Audio source</label>
            <select class="input" name="audio_source" id="audioSource">
                <option value="tts" ${source === 'tts' ? 'selected' : ''}>Generate narration from text</option>
                <option value="upload" ${source === 'upload' ? 'selected' : ''}>I'll upload a recording</option>
            </select>
        </div>
        <div class="field" id="ttsField">
            <label>Spoken description (what callers will hear)</label>
            <textarea class="input" name="description_text" rows="5">${l.description_text ?? ''}</textarea>
        </div>
        <div class="field" id="uploadField" style="display:none">
            <label>Upload recording (MP3)</label>
            <p class="muted">${isNew
              ? 'Save the listing first, then return here to upload your MP3.'
              : 'Upload an MP3 (max 15 MB). This replaces any existing audio.'}</p>
        </div>
        <hr class="form-rule">
        <div class="field">
            <label>Press-1 text message (sent to callers)</label>
            <textarea class="input" name="sms_blurb" id="smsBlurb" maxlength="${SMS_MAX}" rows="3" required>${l.sms_blurb ?? ''}</textarea>
            <div class="counter"><span id="smsCount">0</span>/${SMS_MAX}</div>
        </div>
        ${isNew
          ? html`<div class="field">
            <label>Choose a local number — area code</label>
            <div style="display:flex;gap:10px">
                <input class="input" id="areaCode" placeholder="e.g. 864" maxlength="3" inputmode="numeric" style="max-width:140px">
                <button type="button" class="btn" id="searchBtn">Search numbers</button>
            </div>
            <div id="numberResults" style="margin-top:14px"></div>
            <input type="hidden" name="chosen_number" id="chosenNumber">
        </div>`
          : ''}
        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" type="submit">
            ${isNew ? 'Save & provision number ($5 now)' : 'Save changes'}
        </button>
    </form>
</div>
${!isNew
  ? html`<div class="card narrow">
    <h2 style="font-size:18px">Upload a recording</h2>
    <p class="sub">Optional — use your own MP3 instead of generated narration.</p>
    <form method="post" action="/audio_upload" enctype="multipart/form-data">
        <input type="hidden" name="csrf" value="${o.csrf}">
        <input type="hidden" name="id" value="${l.id ?? ''}">
        <div class="field">
            <input class="input" type="file" name="audio" accept="audio/mpeg,.mp3" required>
        </div>
        <button class="btn" type="submit">Upload MP3</button>
    </form>
</div>`
  : ''}
<script>
${raw(`const src = document.getElementById('audioSource');
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
sms.addEventListener('input', upd); upd();`)}
${isNew
  ? raw(`
const searchBtn = document.getElementById('searchBtn');
const results = document.getElementById('numberResults');
const chosen = document.getElementById('chosenNumber');
function note(text) {
    const p = document.createElement('p'); p.className = 'muted'; p.textContent = text;
    results.replaceChildren(p);
}
searchBtn.addEventListener('click', async () => {
    const ac = document.getElementById('areaCode').value.trim();
    if (!/^\\d{3}$/.test(ac)) { note('Enter a 3-digit area code.'); return; }
    note('Searching…');
    try {
        const r = await fetch('/numbers_search?area=' + ac);
        const data = await r.json();
        if (!data.ok) { note(data.error || 'No numbers found.'); return; }
        results.replaceChildren(...data.numbers.map(n => {
            const row = document.createElement('div'); row.className = 'num-pick';
            const label = document.createElement('span'); label.style.fontVariantNumeric = 'tabular-nums';
            label.textContent = n.friendly || n.phone;
            if (n.locality) {
                const loc = document.createElement('span'); loc.className = 'muted'; loc.textContent = ' · ' + n.locality;
                label.appendChild(loc);
            }
            const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-sm'; btn.textContent = 'Choose';
            btn.addEventListener('click', () => {
                chosen.value = n.phone;
                results.querySelectorAll('.num-pick').forEach(x => { x.style.opacity = .4; x.querySelector('button').textContent = 'Choose'; });
                row.style.opacity = 1;
                btn.textContent = 'Selected ✓';
            });
            row.append(label, btn);
            return row;
        }));
    } catch (e) { note('Search failed.'); }
});
document.getElementById('listingForm').addEventListener('submit', (ev) => {
    if (!chosen.value) { ev.preventDefault(); note('Choose a phone number for this home.'); }
});`)
  : ''}
</script>`;
}
