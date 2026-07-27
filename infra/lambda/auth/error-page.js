'use strict';

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderErrorPage(email, switchAccountUrl) {
  const safeEmail = escapeHtml(email);
  const safeUrl = escapeHtml(switchAccountUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Access not permitted</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0f1117; color: #e2e8f0; font-family: system-ui, sans-serif;
           min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; }
    .card { background: #1a1f2e; border: 1px solid #2d3748; border-radius: 16px;
            padding: 2.5rem; max-width: 420px; width: 100%; text-align: center; }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem; }
    .email { display: inline-block; background: rgba(239,68,68,0.1);
             border: 1px solid rgba(239,68,68,0.25); color: #fca5a5;
             border-radius: 6px; padding: 0.2rem 0.6rem; font-family: monospace; margin: 0.75rem 0; }
    .message { color: #94a3b8; line-height: 1.6; margin-bottom: 2rem; }
    .btn { display: block; width: 100%; padding: 0.75rem; border-radius: 8px;
           font-size: 0.9rem; font-weight: 600; border: none; cursor: pointer; margin-bottom: 0.75rem; }
    .btn-primary { background: #4f46e5; color: white; }
    .btn-primary:disabled { background: #2d3748; color: #64748b; cursor: not-allowed; }
    .btn-secondary { background: transparent; border: 1px solid #334155; color: #94a3b8; }
    .countdown { font-size: 0.78rem; color: #f59e0b; min-height: 1.2em; margin-top: 0.4rem; }
    hr { border: none; border-top: 1px solid #1e293b; margin: 1.25rem 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🚫</div>
    <h1>Access not permitted</h1>
    <div class="email">${safeEmail}</div>
    <p class="message">This email address is not on the access list for this site. If you think this is a mistake, contact the site owner.</p>
    <button class="btn btn-primary" id="retry" disabled onclick="window.location='/'">Try again</button>
    <div class="countdown" id="cd">You can try again in <span id="t">60</span>s</div>
    <hr/>
    <button class="btn btn-secondary" onclick="window.location='${safeUrl}'">Try a different Google account</button>
  </div>
  <script>
    let s = 60;
    const t = document.getElementById('t');
    const cd = document.getElementById('cd');
    const btn = document.getElementById('retry');
    const i = setInterval(function() {
      s--;
      t.textContent = s;
      if (s <= 0) { clearInterval(i); btn.disabled = false; cd.textContent = ''; }
    }, 1000);
  </script>
</body>
</html>`;
}

module.exports = { renderErrorPage, escapeHtml };
