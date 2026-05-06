const BOT_TOKEN = "8762540625:AAGhyP5X_4__uRgws9m8piZvia6_av5sQQU";
const CHAT_ID   = "688063138";

let allProducts  = [];
let activeProduct = null;

/* ── DOM refs (кешуємо один раз) ── */
let $grid, $noRes, $count, $backdrop;

/* ══════════════════════════════════════════
   0.  ВІДЕО → КАДР  (canvas, один раз)
══════════════════════════════════════════ */

const thumbCache = {};   // { videoUrl: objectURL }

/**
 * Витягує перший кадр з відео через <video>+<canvas>.
 * Повертає ObjectURL PNG (або photoFallback при помилці).
 */
function extractThumb(videoUrl, photoFallback) {
  if (thumbCache[videoUrl]) return Promise.resolve(thumbCache[videoUrl]);

  return new Promise(resolve => {
    const vid = document.createElement('video');
    vid.muted      = true;
    vid.playsInline = true;
    vid.preload    = 'metadata';   // тільки метадані, не весь файл
    vid.crossOrigin = 'anonymous';

    const cleanup = () => {
      vid.src = '';
      vid.load();
    };

    vid.onloadeddata = () => {
      // seekToкадру 0.01 с щоб уникнути чорного першого кадру
      vid.currentTime = 0.5;
    };

    vid.onseeked = () => {
      try {
        const canvas  = document.createElement('canvas');
        canvas.width  = 300;
        canvas.height = 400;
        const ctx     = canvas.getContext('2d');
        ctx.drawImage(vid, 0, 0, 300, 400);
        canvas.toBlob(blob => {
          cleanup();
          if (!blob) { resolve(photoFallback); return; }
          const url = URL.createObjectURL(blob);
          thumbCache[videoUrl] = url;
          resolve(url);
        }, 'image/jpeg', 0.82);
      } catch {
        cleanup();
        resolve(photoFallback);
      }
    };

    vid.onerror = () => { cleanup(); resolve(photoFallback); };

    // Таймаут 6 с — якщо відео недоступне
    const timer = setTimeout(() => { cleanup(); resolve(photoFallback); }, 6000);
    vid.addEventListener('seeked', () => clearTimeout(timer), { once: true });

    vid.src = videoUrl;
    vid.load();
  });
}

/* ══════════════════════════════════════════
   1. INIT & RENDER
══════════════════════════════════════════ */

async function initCatalog() {
  $grid    = document.getElementById('productsGrid');
  $noRes   = document.getElementById('noResults');
  $count   = document.getElementById('resultCount');
  $backdrop = document.getElementById('modalBackdrop');

  try {
    const res = await fetch('products.json?v=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
    allProducts = data.filter(p => p.sku && p.sku.trim() !== '-' && p.name);

    // Пре-обробка: якщо є відео але немає фото — одразу витягуємо кадр (паралельно)
    const thumbJobs = allProducts
      .filter(p => p.video && !p.photo)
      .map(async p => {
        p.photo = await extractThumb(p.video, '');
      });
    // Не чекаємо — рендеримо з тим, що є, кадри підтягнуться
    Promise.all(thumbJobs).catch(() => {});

    renderProducts(allProducts);
  } catch (err) {
    console.error('Каталог:', err);
    if ($grid) {
      $grid.innerHTML = `<p style="color:#c00;padding:20px;grid-column:1/-1;text-align:center">
        Не вдалося завантажити каталог.</p>`;
    }
  }
}

/* ── Lazy-load через IntersectionObserver ── */
let imgObserver;
function getObserver() {
  if (imgObserver) return imgObserver;
  imgObserver = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target;
      if (img.dataset.src) {
        img.src = img.dataset.src;
        delete img.dataset.src;
      }
      obs.unobserve(img);
    });
  }, { rootMargin: '200px' });   // починаємо завантажувати за 200px до появи
  return imgObserver;
}

function renderProducts(list) {
  if (!$grid) return;

  if (!list.length) {
    $grid.innerHTML = '';
    $noRes.style.display = 'block';
    if ($count) $count.textContent = '';
    return;
  }

  $noRes.style.display = 'none';
  if ($count) $count.textContent = list.length + ' товарів';

  const frag = document.createDocumentFragment();
  const obs  = getObserver();

  list.forEach((p, i) => {
    const article = document.createElement('article');
    article.className = 'product-card';
    article.setAttribute('data-sku', p.sku);

    // Перші 6 карток — eager, решта — lazy
    const eager   = i < 6;
    const imgSrc  = p.photo || '';
    const imgTag  = eager
      ? `<img src="${imgSrc}" alt="${escHtml(p.name)}" width="300" height="400" decoding="async" fetchpriority="${i < 2 ? 'high' : 'auto'}" />`
      : `<img data-src="${imgSrc}" alt="${escHtml(p.name)}" width="300" height="400" decoding="async" />`;

    const opt = (cls, val) => val ? `<p class="${cls}">${escHtml(val)}</p>` : '';

    article.innerHTML = `
      <div class="card-img-wrap">${imgTag}</div>
      <div class="card-body">
        <p class="card-article">Арт. ${escHtml(p.sku)}</p>
        <h3 class="card-name">${escHtml(p.name)}</h3>
        <h3 class="card-material">${escHtml(p.material)}</h3>
        <h3 class="card-probe">${escHtml(p.probe)}</h3>
        <h3 class="card-stones">${escHtml(p.stones)}</h3>
        <div class="card-footer">
          <span class="card-price">${p.price} ₴</span>
          <button class="btn-buy" aria-label="Купити ${escHtml(p.name)}">Купити</button>
        </div>
      </div>`;

    // Якщо є відео але ще немає фото — витягуємо кадр у фоні
    if (p.video && !p.photo) {
      extractThumb(p.video, '').then(url => {
        const img = article.querySelector('img');
        if (img && url) {
          if (img.dataset.src !== undefined) img.dataset.src = url;
          else img.src = url;
          p.photo = url;
        }
      });
    }

    // Реєструємо lazy-img в observer
    if (!eager) {
      const img = article.querySelector('img');
      if (img) obs.observe(img);
    }

    // Один listener на картку (event delegation від article)
    article.addEventListener('click', e => {
      const sku = article.dataset.sku;
      if (e.target.classList.contains('btn-buy') || e.currentTarget === article) {
        e.stopPropagation();
        openModal(sku);
      }
    });

    frag.appendChild(article);
  });

  $grid.innerHTML = '';
  $grid.appendChild(frag);
}

/* ══════════════════════════════════════════
   2. SEARCH  (debounced)
══════════════════════════════════════════ */

let searchTimer;
function handleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    if (!q) { renderProducts(allProducts); return; }

    const filtered = allProducts.filter(p =>
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
    renderProducts(filtered);

    document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 220);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'searchInput') handleSearch();
});

/* ══════════════════════════════════════════
   3. MODAL — OPEN / CLOSE
══════════════════════════════════════════ */

function openModal(sku) {
  const p = allProducts.find(item => item.sku === sku);
  if (!p) return;
  activeProduct = p;

  // Завжди фото (відео більше не показуємо)
  const previewWrap = document.getElementById('modalMediaWrap');
  if (previewWrap) {
    const photoSrc = p.photo || '';
    previewWrap.innerHTML = `<img src="${photoSrc}" alt="${escHtml(p.name)}"
      style="width:100%;height:100%;object-fit:cover;border-radius:6px" decoding="async" />`;
  }

  document.getElementById('modalProductName').textContent    = p.name;
  document.getElementById('modalProductArticle').textContent = 'Арт. ' + p.sku;
  document.getElementById('modalProductPrice').textContent   = p.price + ' ₴';

  resetModal();

  $backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (window.innerWidth >= 600) {
    setTimeout(() => document.getElementById('fName')?.focus(), 300);
  }
}

function closeModal() {
  $backdrop.classList.remove('open');
  document.body.style.overflow = '';
  activeProduct = null;
}

function handleBackdropClick(e) {
  if (e.target === $backdrop) closeModal();
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

function resetModal() {
  document.getElementById('modalForm').style.display = '';
  document.getElementById('modalSuccess').classList.remove('show');
  ['fName', 'fPhone', 'fCity'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('error'); }
  });
  const btn = document.getElementById('submitBtn');
  if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
}

/* ══════════════════════════════════════════
   4. ORDER — VALIDATE + TELEGRAM
══════════════════════════════════════════ */

async function processOrder() {
  const name  = document.getElementById('fName')?.value.trim()  || '';
  const phone = document.getElementById('fPhone')?.value.trim() || '';
  const city  = document.getElementById('fCity')?.value.trim()  || '';

  let hasError = false;
  if (!name)  { markError('fName');  hasError = true; }
  if (!phone) { markError('fPhone'); hasError = true; }
  if (!city)  { markError('fCity');  hasError = true; }
  if (hasError) return;

  const btn = document.getElementById('submitBtn');
  btn.classList.add('loading');
  btn.disabled = true;

  const msg = [
    '🛍 <b>НОВЕ ЗАМОВЛЕННЯ</b>', '',
    `📦 Товар:   <b>${activeProduct?.name || '—'}</b>`,
    `🏷 Артикул: <code>${activeProduct?.sku || '—'}</code>`,
    `💰 Ціна:    <b>${activeProduct?.price || '—'} ₴</b>`, '',
    `👤 Ім'я:    ${name}`,
    `📞 Телефон: ${phone}`,
    `🏙 Місто:   ${city}`, '',
    `🕐 ${new Date().toLocaleString('uk-UA')}`
  ].join('\n');

  try {
    const ok = await sendToTelegram(msg);
    if (!ok) throw new Error('Telegram error');
    document.getElementById('modalForm').style.display = 'none';
    document.getElementById('modalSuccess').classList.add('show');
  } catch (err) {
    console.error(err);
    alert('Виникла помилка. Зверніться до менеджера: @m2300m');
    btn.classList.remove('loading');
    btn.disabled = false;
  }
}

async function sendToTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
  });
  if (!res.ok) { console.error(await res.json().catch(() => ({}))); return false; }
  return true;
}

function markError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('error');
  el.addEventListener('input', () => el.classList.remove('error'), { once: true });
}

/* ══════════════════════════════════════════
   5. HELPERS
══════════════════════════════════════════ */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ══════════════════════════════════════════
   6. BOOT
══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', initCatalog);
