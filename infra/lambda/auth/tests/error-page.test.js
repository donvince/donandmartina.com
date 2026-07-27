const { renderErrorPage, escapeHtml } = require('../error-page');

describe('escapeHtml', () => {
  it('escapes dangerous characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a&b')).toBe('a&amp;b');
  });
});

describe('renderErrorPage', () => {
  it('includes the rejected email address', () => {
    const html = renderErrorPage('evil@gmail.com', 'https://example.com/login');
    expect(html).toContain('evil@gmail.com');
  });

  it('escapes the email to prevent XSS', () => {
    const html = renderErrorPage('<b>bad</b>@gmail.com', 'https://example.com/login');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('includes the switch-account URL', () => {
    const html = renderErrorPage('x@x.com', 'https://auth.example.com/switch');
    expect(html).toContain('https://auth.example.com/switch');
  });

  it('returns a complete HTML document', () => {
    const html = renderErrorPage('x@x.com', 'https://example.com');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });
});
