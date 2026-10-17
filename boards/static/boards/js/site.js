// Login / sign-up page behaviour: show/hide password, strength meter, match check, loading state.
(() => {
  // Show / hide password
  document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.target);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.querySelector('i').className = show ? 'bi bi-eye-slash' : 'bi bi-eye';
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      button.title = button.getAttribute('aria-label');
      input.focus();
    });
  });

  // Password strength + checklist (sign-up only)
  const password = document.getElementById('id_password1');
  const confirm = document.getElementById('id_password2');
  const username = document.getElementById('id_username');
  const fill = document.getElementById('strengthFill');
  const label = document.getElementById('strengthLabel');
  const LEVELS = [
    { text: 'Too weak', color: '#dc3545' },
    { text: 'Weak', color: '#fd7e14' },
    { text: 'Fair', color: '#ffc107' },
    { text: 'Good', color: '#20c997' },
    { text: 'Strong', color: '#0d9488' },
  ];

  function checkStrength() {
    const value = password.value;
    const name = (username && username.value || '').toLowerCase();
    const rules = {
      length: value.length >= 8,
      mix: /[a-z]/i.test(value) && /\d/.test(value),
      notName: value.length > 0 && !(name.length >= 3 && value.toLowerCase().includes(name)),
    };
    document.querySelectorAll('.checklist [data-rule]').forEach(item => {
      const ok = rules[item.dataset.rule];
      item.classList.toggle('ok', ok);
      item.querySelector('i').className = ok ? 'bi bi-check-circle-fill' : 'bi bi-circle';
    });
    let score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
    if (/\d/.test(value)) score++;
    if (/[^a-z0-9]/i.test(value)) score++;
    if (!rules.length || !rules.notName) score = Math.min(score, 1);
    const level = LEVELS[Math.min(score, 4)];
    fill.style.width = value ? `${Math.max(12, (Math.min(score, 4) + 1) * 20)}%` : '0';
    fill.style.background = level.color;
    label.textContent = value ? level.text : '–';
    label.style.color = value ? level.color : '';
  }

  function checkMatch() {
    const hint = document.getElementById('matchHint');
    if (!confirm.value) { hint.textContent = ''; hint.className = 'small mb-4 match-hint'; return; }
    const same = confirm.value === password.value;
    hint.innerHTML = same
      ? '<i class="bi bi-check-circle-fill"></i> Passwords match'
      : '<i class="bi bi-x-circle-fill"></i> Passwords don’t match yet';
    hint.className = `small mb-4 match-hint ${same ? 'text-success' : 'text-danger'}`;
  }

  if (password && fill) {
    password.addEventListener('input', () => { checkStrength(); if (confirm) checkMatch(); });
    if (username) username.addEventListener('input', checkStrength);
    if (confirm) confirm.addEventListener('input', checkMatch);
    checkStrength();
  }

  // Loading state, and no double submits
  document.querySelectorAll('.js-auth-form').forEach(form => {
    form.addEventListener('submit', () => {
      const button = form.querySelector('.js-submit');
      button.disabled = true;
      button.querySelector('.spinner-border').classList.remove('d-none');
      button.querySelector('.label').textContent = button.querySelector('.label').textContent.replace(/^(.*)$/, '$1…');
    });
  });

  // Focus the first empty (or first invalid) field
  const first = document.querySelector('.js-auth-form .is-invalid, .js-auth-form input.form-control:placeholder-shown');
  if (first) first.focus();
})();
