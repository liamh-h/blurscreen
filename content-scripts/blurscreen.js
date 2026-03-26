class BlurScreen {
  constructor() {
    this.isActive = false;
    this.blurredElements = [];
    this.freeBoxes = [];
    this.hoveredElement = null;
    this.usageCount = 0;
    this.isPaid = false;
    this.pageKey = '';
    this.hasNewBlurs = false;
    this.isDragging = false;
    this.justFinishedDrag = false;
    this.dragStart = null;
    this.currentBox = null;
    this.toolbar = null;
  }

  async init() {
    this.pageKey = `${location.hostname}${location.pathname}`;
    try {
      await this.loadPaymentStatus();
      await this.loadUsageCount();
      await this.restoreBlurs();
    } catch {}
    this.setupEventListeners();
    this.updateBadge();
  }

  // ==================== Toolbar ====================

  showToolbar() {
    if (this.toolbar) return;
    const tb = document.createElement('div');
    tb.className = 'blurscreen-toolbar blurscreen-ui';
    tb.innerHTML = `
      <span class="tb-label"><span class="tb-dot"></span> BlurScreen</span>
      <span class="tb-divider"></span>
      <span class="tb-hint">Click element to blur &nbsp;|&nbsp; <kbd>Alt</kbd>+drag to draw box</span>
      <span class="tb-divider"></span>
      <span class="tb-count" id="bs-count">0</span>
      <button class="tb-btn" id="bs-tb-detect">Auto-detect</button>
      <button class="tb-btn danger" id="bs-tb-clear">Clear all</button>
      <button class="tb-close" id="bs-tb-close">\u00d7</button>
    `;
    document.body.appendChild(tb);
    this.toolbar = tb;

    tb.querySelector('#bs-tb-detect').addEventListener('click', (e) => { e.stopPropagation(); this.autoDetect(); });
    tb.querySelector('#bs-tb-clear').addEventListener('click', (e) => { e.stopPropagation(); this.clearAll(); });
    tb.querySelector('#bs-tb-close').addEventListener('click', (e) => { e.stopPropagation(); this.deactivate(); });
    this.updateToolbarCount();
  }

  removeToolbar() {
    if (this.toolbar) { this.toolbar.remove(); this.toolbar = null; }
  }

  updateToolbarCount() {
    if (!this.toolbar) return;
    const count = this.blurredElements.length + this.freeBoxes.length +
      document.querySelectorAll('.blurscreen-auto-detected').length;
    const el = this.toolbar.querySelector('#bs-count');
    if (el) el.textContent = String(count);
  }

  // ==================== Mode Control ====================

  activate() {
    if (!this.isPaid && this.usageCount >= 3) { this.showPaywall(); return; }
    this.isActive = true;
    document.body.classList.add('blurscreen-active');
    this.showToolbar();
    this.updateBadge();
  }

  deactivate() {
    this.isActive = false;
    document.body.classList.remove('blurscreen-active');
    this.removeHighlight();
    this.removeToolbar();
    this.updateBadge();
    if (this.hasNewBlurs) {
      this.incrementUsage();
      this.hasNewBlurs = false;
      if (!this.isPaid) {
        const left = Math.max(0, 3 - this.usageCount);
        this.showNotification(left > 0 ? `${left} free session${left !== 1 ? 's' : ''} remaining` : 'Free sessions used up');
      }
    }
  }

  toggle() { this.isActive ? this.deactivate() : this.activate(); }

  // ==================== Click to Blur ====================

  handleMouseMove(e) {
    if (!this.isActive || this.isDragging) return;
    const el = this.getBlurrableElement(e.target);
    if (el === this.hoveredElement) return;
    this.removeHighlight();
    if (!el) return;
    this.hoveredElement = el;
    el.classList.add('blurscreen-highlight');
  }

  getBlurrableElement(el) {
    // Skip body, html, blurscreen UI, and elements that are too large
    if (!el || el.tagName === 'BODY' || el.tagName === 'HTML') return null;
    if (el.closest('.blurscreen-ui')) return null;
    if (el.closest('.blurscreen-freebox')) return null;
    // Prevent blurring massive containers (>70% of viewport)
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (rect.width > vw * 0.7 && rect.height > vh * 0.7) {
      // Try to find a smaller child instead, or skip
      return null;
    }
    return el;
  }

  handleClick(e) {
    if (!this.isActive) return;
    if (this.justFinishedDrag) { this.justFinishedDrag = false; return; }
    const el = this.getBlurrableElement(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();

    if (el.classList.contains('blurscreen-blurred')) {
      this.unblurElement(el);
    } else {
      this.blurElement(el);
    }
  }

  blurElement(el) {
    const uid = `bs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    el.dataset.blurscreenId = uid;
    el.classList.add('blurscreen-blurred');
    el.classList.remove('blurscreen-highlight');
    this.blurredElements.push({ selector: `[data-blurscreen-id="${uid}"]`, type: 'element' });
    this.hasNewBlurs = true;
    this.saveBlurs();
    this.updateBadge();
    this.updateToolbarCount();
  }

  unblurElement(el) {
    el.classList.remove('blurscreen-blurred');
    const uid = el.dataset.blurscreenId;
    if (uid) {
      this.blurredElements = this.blurredElements.filter(b => b.selector !== `[data-blurscreen-id="${uid}"]`);
      delete el.dataset.blurscreenId;
    }
    this.saveBlurs();
    this.updateBadge();
    this.updateToolbarCount();
  }

  // ==================== Free-draw Blur ====================

  startFreeBlur(e) {
    if (!this.isActive || !e.altKey) return;
    e.preventDefault();
    this.isDragging = true;
    this.removeHighlight();
    this.dragStart = { x: e.pageX, y: e.pageY };
    const box = document.createElement('div');
    box.className = 'blurscreen-freebox blurscreen-ui';
    Object.assign(box.style, { left: this.dragStart.x + 'px', top: this.dragStart.y + 'px', width: '0px', height: '0px' });
    document.body.appendChild(box);
    this.currentBox = box;
  }

  updateFreeBlur(e) {
    if (!this.isDragging || !this.currentBox) return;
    e.preventDefault();
    const x = e.pageX, y = e.pageY;
    Object.assign(this.currentBox.style, {
      left: Math.min(this.dragStart.x, x) + 'px', top: Math.min(this.dragStart.y, y) + 'px',
      width: Math.abs(x - this.dragStart.x) + 'px', height: Math.abs(y - this.dragStart.y) + 'px'
    });
  }

  endFreeBlur(e) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.justFinishedDrag = true;
    setTimeout(() => { this.justFinishedDrag = false; }, 100);
    const box = this.currentBox;
    this.currentBox = null;
    if (!box || box.offsetWidth < 20 || box.offsetHeight < 20) { if (box) box.remove(); return; }

    // Add close button
    const closeBtn = document.createElement('span');
    closeBtn.className = 'blurscreen-freebox-close blurscreen-ui';
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      box.remove();
      this.freeBoxes = this.freeBoxes.filter(b => b.el !== box);
      this.saveBlurs(); this.updateBadge(); this.updateToolbarCount();
    });
    box.appendChild(closeBtn);

    this.freeBoxes.push({
      el: box,
      rect: { left: parseInt(box.style.left), top: parseInt(box.style.top), width: box.offsetWidth, height: box.offsetHeight }
    });
    this.hasNewBlurs = true;
    this.saveBlurs(); this.updateBadge(); this.updateToolbarCount();
  }

  // ==================== Auto Detect ====================

  autoDetect() {
    if (!this.isPaid && this.usageCount >= 3) { this.showPaywall(); return; }
    const detections = SensitiveDetector.scan(document.body);
    let count = 0;
    for (const { node, matches } of detections) {
      for (const match of matches) {
        try {
          if (!node.parentNode) break;
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match.text.length);
          const wrapper = document.createElement('span');
          wrapper.className = 'blurscreen-blurred blurscreen-auto-detected';
          wrapper.dataset.blurType = match.type;
          range.surroundContents(wrapper);
          count++;
        } catch {}
      }
    }
    if (count > 0) { this.hasNewBlurs = true; this.incrementUsage(); }
    this.updateBadge(); this.updateToolbarCount();
    this.showNotification(count > 0 ? `Found & blurred ${count} sensitive item${count > 1 ? 's' : ''}` : 'No sensitive info detected');
  }

  // ==================== Persistence ====================

  async saveBlurs() {
    if (!this.isPaid) return;
    try {
      await chrome.storage.local.set({ [`blur_${this.pageKey}`]: {
        elements: this.blurredElements, freeBoxes: this.freeBoxes.map(b => b.rect), timestamp: Date.now()
      }});
    } catch {
      try { await this.evictOldBlurs(); } catch {}
    }
  }

  async evictOldBlurs() {
    const all = await chrome.storage.local.get(null);
    const entries = Object.entries(all).filter(([k]) => k.startsWith('blur_'))
      .sort((a, b) => (a[1]?.timestamp || 0) - (b[1]?.timestamp || 0));
    const toRemove = entries.slice(0, Math.ceil(entries.length / 2)).map(([k]) => k);
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
  }

  async restoreBlurs() {
    if (!this.isPaid) return;
    const result = await chrome.storage.local.get(`blur_${this.pageKey}`);
    const data = result[`blur_${this.pageKey}`];
    if (!data) return;
    this.blurredElements = data.elements || [];
    let restored = 0;
    for (const entry of this.blurredElements) {
      try {
        const el = document.querySelector(entry.selector);
        if (el) { el.classList.add('blurscreen-blurred'); restored++; }
      } catch {}
    }
    (data.freeBoxes || []).forEach(rect => {
      const box = document.createElement('div');
      box.className = 'blurscreen-freebox blurscreen-ui';
      Object.assign(box.style, { left: rect.left+'px', top: rect.top+'px', width: rect.width+'px', height: rect.height+'px' });
      const close = document.createElement('span');
      close.className = 'blurscreen-freebox-close blurscreen-ui';
      close.textContent = '\u00d7';
      close.addEventListener('click', () => { box.remove(); this.freeBoxes = this.freeBoxes.filter(b => b.el !== box); this.saveBlurs(); this.updateBadge(); });
      box.appendChild(close);
      document.body.appendChild(box);
      this.freeBoxes.push({ el: box, rect });
      restored++;
    });
    if (restored > 0) this.updateBadge();
  }

  // ==================== Usage & Payment ====================

  async loadUsageCount() {
    const r = await chrome.storage.local.get('blurscreen_usage');
    this.usageCount = r.blurscreen_usage || 0;
  }

  async incrementUsage() {
    if (this.isPaid) return;
    this.usageCount++;
    try { await chrome.storage.local.set({ blurscreen_usage: this.usageCount }); } catch {}
  }

  async loadPaymentStatus() {
    try {
      // Check via background (which reads chrome.storage.sync)
      const response = await chrome.runtime.sendMessage({ type: 'get-payment-status' });
      if (response?.paid) { this.isPaid = true; return; }
    } catch {}
    try {
      // Also check ExtPay's own storage key
      const r = await chrome.storage.sync.get('extpay_user');
      if (r.extpay_user?.paid) { this.isPaid = true; return; }
    } catch {}
    this.isPaid = false;
  }

  showPaywall() {
    if (document.querySelector('.blurscreen-paywall')) return;
    const overlay = document.createElement('div');
    overlay.className = 'blurscreen-paywall blurscreen-ui';
    overlay.innerHTML = `
      <div class="blurscreen-paywall-card">
        <div class="blurscreen-paywall-close">\u00d7</div>
        <h2>\ud83d\udee1\ufe0f BlurScreen</h2>
        <p>You've used your 3 free sessions.</p>
        <p>One-time payment of <strong>$1.99</strong> to unlock forever:</p>
        <ul>
          <li>Unlimited blurring</li>
          <li>Auto-detect sensitive info</li>
          <li>Persistent blur settings</li>
          <li>All future updates</li>
        </ul>
        <button class="blurscreen-buy-btn">Unlock for $1.99</button>
        <p class="blurscreen-paywall-note">One-time \u00b7 No subscription \u00b7 Cheaper than coffee \u2615</p>
      </div>
    `;
    overlay.querySelector('.blurscreen-paywall-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.blurscreen-buy-btn').addEventListener('click', () => {
      // Tell background to open payment page
      chrome.runtime.sendMessage({ type: 'open-payment' });
      overlay.remove();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ==================== Utilities ====================

  removeHighlight() {
    if (this.hoveredElement) { this.hoveredElement.classList.remove('blurscreen-highlight'); this.hoveredElement = null; }
  }

  updateBadge() {
    const count = this.blurredElements.length + this.freeBoxes.length + document.querySelectorAll('.blurscreen-auto-detected').length;
    try { chrome.runtime.sendMessage({ type: 'update-badge', count: count > 0 ? String(count) : '', active: this.isActive }); } catch {}
  }

  showNotification(text) {
    const existing = document.querySelector('.blurscreen-notification');
    if (existing) existing.remove();
    const n = document.createElement('div');
    n.className = 'blurscreen-notification blurscreen-ui';
    n.textContent = text;
    document.body.appendChild(n);
    requestAnimationFrame(() => n.classList.add('show'));
    setTimeout(() => { n.classList.remove('show'); setTimeout(() => n.remove(), 300); }, 2500);
  }

  clearAll() {
    const autoSpans = document.querySelectorAll('span.blurscreen-auto-detected');
    document.querySelectorAll('.blurscreen-blurred').forEach(el => { el.classList.remove('blurscreen-blurred'); delete el.dataset.blurscreenId; });
    this.blurredElements = [];
    autoSpans.forEach(span => { const p = span.parentNode; if (!p) return; while (span.firstChild) p.insertBefore(span.firstChild, span); span.remove(); p.normalize(); });
    document.querySelectorAll('.blurscreen-freebox').forEach(el => el.remove());
    this.freeBoxes = [];
    this.hasNewBlurs = false;
    try { chrome.storage.local.remove(`blur_${this.pageKey}`); } catch {}
    this.updateBadge(); this.updateToolbarCount();
    this.showNotification('All blurs cleared');
  }

  // ==================== Events ====================

  setupEventListeners() {
    document.addEventListener('mousemove', (e) => { this.handleMouseMove(e); this.updateFreeBlur(e); }, true);
    document.addEventListener('click', (e) => this.handleClick(e), true);
    document.addEventListener('mousedown', (e) => this.startFreeBlur(e));
    document.addEventListener('mouseup', (e) => this.endFreeBlur(e));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isActive) this.deactivate(); });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'toggle') this.toggle();
      if (msg.type === 'auto-detect') { if (!this.isActive) this.activate(); this.autoDetect(); }
      if (msg.type === 'clear-all') this.clearAll();
      if (msg.type === 'payment-updated' && msg.paid) {
        this.isPaid = true;
        this.showNotification('Unlocked! Thank you for supporting BlurScreen.');
      }
    });
  }
}

const blurscreen = new BlurScreen();
blurscreen.init();
