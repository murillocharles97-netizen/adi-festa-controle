'use strict';

// Read-only HTTP probe with a reserved fictional NANP number. No WhatsApp login,
// message send, app launch or store data. The response shows the web handoff only.
const { execFileSync } = require('node:child_process');
const phone = '12025550101';
const browsers = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/146.0.0.0 Mobile Safari/537.36',
};
const cartSample = '🍓 Café & bolo?\n';
const prefix = `https://api.whatsapp.com/send/?phone=${phone}&text=`;

function request(url, agent, format, output) {
  return execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl',
    ['--silent', '--show-error', '--max-time', '15', '--user-agent', agent, '--write-out', format, '--output', output, url],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

for (const [browser, agent] of Object.entries(browsers)) {
  const redirect = request(`https://wa.me/${phone}?text=${encodeURIComponent(cartSample)}`, agent,
    '%{redirect_url}', process.platform === 'win32' ? 'NUL' : '/dev/null');
  const redirectPreservedText = redirect ? new URL(redirect).searchParams.get('text') === cartSample : null;
  for (const bytes of [400, 4000, 8000, 21000]) {
    const available = bytes - prefix.length, encodedSize = encodeURIComponent(cartSample).length;
    const text = cartSample.repeat(Math.floor(available / encodedSize)) + 'x'.repeat(available % encodedSize);
    const response = request(prefix + encodeURIComponent(text), agent, '\n%{http_code}', '-');
    const separator = response.lastIndexOf('\n'), html = response.slice(0, separator), status = Number(response.slice(separator+1));
    const links = [...html.matchAll(/(?:href|content)="([^"]*send[^"]+)"/g)];
    const linksWithText = links.flatMap(([, value]) => {
      try { return [new URL(value.replace(/&amp;/g, '&'), prefix)]; } catch { return []; }
    });
    const web = linksWithText.find(link => link.hostname === 'web.whatsapp.com' && link.searchParams.has('text'));
    console.log(JSON.stringify({ browser, bytes, status, redirectPreservedText,
      pagePreservedText: linksWithText.some(link => link.searchParams.get('text') === text),
      webPreservedText: web ? web.searchParams.get('text') === text : null }));
  }
}
