/* ─────────────────────────────────────────
   CUSTOMLY — script.js (Refactored)
   ───────────────────────────────────────── */

// Увага: Токен на фронтенді — це ризик. Рекомендується перенести на сервер.
const _0x4a = "8762540625:AAGhyP5X_4__uRgws9m8piZvia6_av5sQQU"; 
const CHAT_ID = "688063138";

let allProducts = [];
let activeProduct = null;
const thumbCache = {};

// Кеш DOM-елементів
const UI = {
  grid: null,
  noRes: null,
  count: null,
  backdrop: null,
  searchInput: null,
  submitBtn: null
};

/* ══════════════════════════════════════════
   1. ОБРОБКА МЕДІА (ОПТИМІЗОВАНА ЧЕРГА)
══════════════════════════════════════════ */

async function extractThumb(videoUrl, photoFallback) {
  if (thumbCache[videoUrl]) return thumbCache[videoUrl];

  return new Promise(resolve => {
    const vid = document.createElement('video');
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = 'metadata';
    vid.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      vid.src = '';
      resolve(photoFallback);
    }, 8000);

    vid.onloadeddata = () => { vid.currentTime = 0.5; };

    vid.onseeked = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 300;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(vid, 0, 0, 300, 400);
        canvas.toBlob(blob => {
          vid.src = '';
          if (!blob) { resolve(photoFallback); return; }
          const url = URL.createObjectURL(blob);
          thumbCache[videoUrl] = url;
          resolve(url);
        }, 'image/jpeg', 0.8);
      } catch {
        resolve(photoFallback);
      }
    };

    vid.onerror = () => { clearTimeout(timeout); resolve(photoFallback); };
    vid.src = videoUrl;
  });
}

/* ══════════════════════════════════════════
   2. ІНІЦІАЛІЗАЦІЯ
══════════════════════════════════════════ */

async function initCatalog() {
  UI.grid = document.getElementById('productsGrid');
  UI.noRes = document.getElementById('noResults');
  UI.count = document.getElementById('resultCount');
  UI.backdrop = document.getElementById('modalBackdrop');
  UI.searchInput = document.getElementById('searchInput');
  UI.submitBtn = document.getElementById('submitBtn');

  try {
    const res = await fetch(`products.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`Помилка завантаження: ${res.status}`);
    
    const data = await res.json();
    
    // Валідація даних
    allProducts = Array.isArray(data) 
      ? data.filter(p => p.sku && p.sku !== '-' && p.name) 
      : [];

    if (allProducts.length === 0) {
      showError("Каталог порожній або пошкоджений.");
      return;
    }

    renderProducts(allProducts);
  } catch (err) {
    console.error('Критична помилка:', err);
    showError("Не вдалося завантажити товари. Будь ласка, оновіть сторінку.");
  }
}

function showError(msg) {
  if (UI.grid) {
    UI.grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:#d94f3b;">${msg}</div>`;
  }
}

/* ══════════════════════════════════════════
   3. РЕНДЕР ТА ПОШУК
══════════════════════════════════════════ */

function renderProducts(list) {
  if (!UI.grid) return;
  UI.grid.innerHTML = '';

  if (!list.length) {
    UI.noRes.style.display = 'block';
    UI.count.textContent = '0 товарів';
    return;
  }

  UI.noRes.style.display = 'none';
  UI.count.textContent = `${list.length} товарів`;

  const fragment = document.createDocumentFragment();
  const observer = getObserver();

  list.forEach((p, i) => {
    const card = document.createElement('article');
    card.className = 'product-card';
    
    // Lazy-loading для зображень
    const isEager = i < 4;
    const imgHtml = isEager 
      ? `<img src="${p.photo || ''}" alt="${esc(p.name)}" loading="eager">`
      : `<img data-src="${p.photo || ''}" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" alt="${esc(p.name)}">`;

    card.innerHTML = `
      <div class="card-img-wrap">${imgHtml}</div>
      <div class="card-body">
        <p class="card-article">Арт. ${esc(p.sku)}</p>
        <h3 class="card-name">${esc(p.name)}</h3>
        <div class="card-footer">
          <span class="card-price">${p.price} ₴</span>
          <button class="btn-buy">Купити</button>
        </div>
      </div>`;

    // Поступова генерація прев'ю для відео
    if (p.video && !p.photo) {
      extractThumb(p.video, '').then(url => {
        const img = card.querySelector('img');
        if (img) {
          if (img.dataset.src !== undefined) img.dataset.src = url;
          else img.src = url;
        }
        p.photo = url;
      });
    }

    if (!isEager) {
      const img = card.querySelector('img');
      if (img) observer.observe(img);
    }

    card.onclick = () => openModal(p.sku);
    fragment.appendChild(card);
  });

  UI.grid.appendChild(fragment);
}

let searchDebounce;
function handleSearch() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    const q = UI.searchInput.value.trim().toLowerCase();
    const filtered = allProducts.filter(p => 
      p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
    renderProducts(filtered);
  }, 300);
}

/* ══════════════════════════════════════════
   4. ЗАМОВЛЕННЯ ТА ВАЛІДАЦІЯ
══════════════════════════════════════════ */

async function processOrder() {
  const fields = {
    name: document.getElementById('fName'),
    phone: document.getElementById('fPhone'),
    city: document.getElementById('fCity')
  };

  let isInvalid = false;

  // Валідація імені
  if (fields.name.value.trim().length < 2) { markErr(fields.name); isInvalid = true; }
  
  // Валідація телефону (мінімум 10 цифр)
  const phoneVal = fields.phone.value.replace(/\D/g, '');
  if (phoneVal.length < 10) { markErr(fields.phone); isInvalid = true; }
  
  if (fields.city.value.trim().length < 2) { markErr(fields.city); isInvalid = true; }

  if (isInvalid) return;

  setLoading(true);

  const message = [
    `🛍 <b>НОВЕ ЗАМОВЛЕННЯ</b>`,
    `Товар: ${activeProduct.name}`,
    `Арт: <code>${activeProduct.sku}</code>`,
    `Ціна: ${activeProduct.price} ₴`,
    `────────────────`,
    `👤 Ім'я: ${fields.name.value.trim()}`,
    `📞 Тел: <code>${fields.phone.value.trim()}</code>`,
    `🏙 Місто: ${fields.city.value.trim()}`
  ].join('\n');

  try {
    const response = await fetch(`https://api.telegram.org/bot${_0x4a}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' })
    });

    if (!response.ok) throw new Error();

    // --- ОНОВЛЕНИЙ БЛОК УСПІХУ ---
    document.getElementById('modalForm').style.display = 'none';
    
    // Вставляємо дані замовлення у вікно успіху
    const successTitle = document.querySelector('#modalSuccess h3');
    const successDetails = document.getElementById('successOrderDetails');
    
    if (successTitle) successTitle.textContent = "Замовлення прийнято!";
    
    if (successDetails) {
      successDetails.innerHTML = `
        <div style="margin: 15px 0; padding: 10px; background: #f9f9f9; border-radius: 8px; text-align: left; font-size: 0.9rem;">
          <p><strong>Товар:</strong> ${activeProduct.name}</p>
          <p><strong>Артикул:</strong> ${activeProduct.sku}</p>
          <p><strong>До сплати:</strong> ${activeProduct.price} ₴</p>
        </div>
      `;
    }

    document.getElementById('modalSuccess').classList.add('show');
    // ----------------------------

  } catch (err) {
    alert("Помилка відправки. Спробуйте ще раз.");
  } finally {
    setLoading(false);
  }
}

/* ══════════════════════════════════════════
   5. ДОПОМІЖНІ ФУНКЦІЇ
══════════════════════════════════════════ */

function setLoading(state) {
  UI.submitBtn.disabled = state;
  UI.submitBtn.classList.toggle('loading', state);
}

function markErr(el) {
  el.classList.add('error');
  el.onclick = () => el.classList.remove('error');
  el.oninput = () => el.classList.remove('error');
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function getObserver() {
  return new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        if (img.dataset.src) img.src = img.dataset.src;
        obs.unobserve(img);
      }
    });
  }, { rootMargin: '100px' });
}

// Модалка (спрощено для прикладу)
function openModal(sku) {
  activeProduct = allProducts.find(p => p.sku === sku);
  if (!activeProduct) return;

  document.getElementById('modalProductName').textContent = activeProduct.name;
  document.getElementById('modalProductPrice').textContent = `${activeProduct.price} ₴`;
  document.getElementById('modalProductArticle').textContent = `Арт. ${activeProduct.sku}`;
  
  const preview = document.getElementById('modalMediaWrap');
  preview.innerHTML = `<img src="${activeProduct.photo || ''}" style="width:100%;height:100%;object-fit:cover;">`;

  resetModal();
  UI.backdrop.classList.add('open');
}

function closeModal() { UI.backdrop.classList.remove('open'); }
function resetModal() {
  document.getElementById('modalForm').style.display = 'block';
  document.getElementById('modalSuccess').classList.remove('show');
}

document.addEventListener('DOMContentLoaded', initCatalog);