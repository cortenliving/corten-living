/**
 * UI theme: vibrant | classic
 * Stored in localStorage so product + shop stay in sync.
 */
(function () {
  const KEY = 'cortenUiTheme';
  const DEFAULT = 'vibrant';

  function getTheme() {
    try {
      const t = localStorage.getItem(KEY);
      if (t === 'classic' || t === 'vibrant') return t;
    } catch (_) {}
    return DEFAULT;
  }

  function applyTheme(theme) {
    const t = theme === 'classic' ? 'classic' : 'vibrant';
    document.documentElement.classList.toggle('ui-vibrant', t === 'vibrant');
    document.documentElement.classList.toggle('ui-classic', t === 'classic');
    document.documentElement.setAttribute('data-ui-theme', t);
    document.querySelectorAll('[data-ui-theme-label]').forEach((el) => {
      el.textContent = t === 'vibrant' ? 'Vibrant look' : 'Classic look';
    });
    document.querySelectorAll('[data-ui-theme-hint]').forEach((el) => {
      el.textContent =
        t === 'vibrant' ? 'Switch to classic' : 'Switch to vibrant';
    });
  }

  function setTheme(theme) {
    const t = theme === 'classic' ? 'classic' : 'vibrant';
    try {
      localStorage.setItem(KEY, t);
    } catch (_) {}
    applyTheme(t);
  }

  function toggleTheme() {
    setTheme(getTheme() === 'vibrant' ? 'classic' : 'vibrant');
    // Refresh shop filter chip styles if present
    try {
      if (typeof window.filterProducts === 'function' && document.querySelector('.filter-btn.active')) {
        const active = document.querySelector('.filter-btn.active');
        const cat = active?.dataset?.filter || 'all';
        window.filterProducts(cat, { skipUrl: true });
      }
    } catch (_) {}
  }

  // Apply ASAP to reduce flash (also call from head if needed)
  applyTheme(getTheme());

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(getTheme());
    document.querySelectorAll('[data-ui-theme-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
      });
    });
  });

  window.getCortenUiTheme = getTheme;
  window.setCortenUiTheme = setTheme;
  window.toggleCortenUiTheme = toggleTheme;
})();
