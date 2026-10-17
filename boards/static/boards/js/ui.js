window.SketchSaathi = window.SketchSaathi || {};

SketchSaathi.ui = (() => {
  const ICONS = {
    success: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.01"/>',
    danger: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  };
  const icon = kind => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[kind] || ICONS.info}</svg>`;

  function host() {
    let el = document.getElementById('toasts');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toasts';
      el.className = 'toasts';
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, kind = 'info', duration = 2600) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = `${icon(kind)}<span></span>`;
    el.querySelector('span').textContent = message;
    host().appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400);
    }, duration);
  }

  function dialog({ title, message = '', confirmText = 'OK', cancelText = 'Cancel', danger = false, input = null }) {
    return new Promise(resolve => {
      const box = document.createElement('dialog');
      box.className = `panel ui-dialog${danger ? ' danger' : ''}`;
      box.innerHTML = `
        <div class="ui-dialog-icon">${icon(danger ? 'danger' : 'info')}</div>
        <h2></h2>
        <p></p>
        ${input !== null ? '<input class="ui-dialog-input" autocomplete="off" spellcheck="false">' : ''}
        <div class="ui-dialog-actions">
          <button type="button" class="ui-cancel"></button>
          <button type="button" class="ui-confirm"></button>
        </div>`;
      box.querySelector('h2').textContent = title;
      box.querySelector('p').textContent = message;
      box.querySelector('p').hidden = !message;
      box.querySelector('.ui-cancel').textContent = cancelText;
      box.querySelector('.ui-confirm').textContent = confirmText;
      const field = box.querySelector('.ui-dialog-input');
      if (field) field.value = input;
      document.body.appendChild(box);

      let result = null;
      const close = value => { result = value; box.close(); };
      box.querySelector('.ui-cancel').onclick = () => close(null);
      box.querySelector('.ui-confirm').onclick = () => close(field ? field.value : true);
      box.addEventListener('click', e => { if (e.target === box) close(null); });
      box.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); close(field ? field.value : true); }
      });
      box.addEventListener('close', () => { box.remove(); resolve(result); });
      box.showModal();
      (field || box.querySelector('.ui-confirm')).focus();
      if (field) field.select();
    });
  }

  return {
    toast,
    confirm: options => dialog(options).then(value => value !== null),
    prompt: options => dialog({ ...options, input: options.value ?? '' }),
  };
})();
