const languageKey = 'file-converter-language';

function savedLanguage() {
  try {
    return localStorage.getItem(languageKey);
  } catch {
    return null;
  }
}

for (const link of document.querySelectorAll('[data-language]')) {
  link.addEventListener('click', () => {
    try {
      localStorage.setItem(languageKey, link.dataset.language);
    } catch {
      // Language links still work when storage is unavailable.
    }
  });
}

if (location.pathname === '/' || location.pathname === '/index.html') {
  const preferred = savedLanguage() ?? navigator.languages?.[0] ?? navigator.language;
  if (/^ar(?:-|$)/i.test(preferred ?? '')) {
    location.replace('/ar/' + location.search + location.hash);
  }
}
