// netlify/functions/email-template.ts
export function renderEmailHTML(opts: {
  subject: string;
  greeting: string; // e.g., "Dear Sen. Sample,"
  body: string;     // plain text body (we'll auto <br/> it)
}) {
  const toHtml = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .split('\n')
      .map((l) => l || '&nbsp;')
      .join('<br/>');

  const greeting = toHtml(opts.greeting);
  const body = toHtml(opts.body);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charSet="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <title>${opts.subject}</title>
    <style>
      .wrapper{background:#f7f7f8;padding:24px;}
      .card{max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px;
            border:1px solid #e5e7eb;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial;}
      .brand{font-weight:700;font-size:18px;color:#111827;margin:0 0 12px;}
      .meta{color:#6b7280;font-size:12px;margin:0 0 16px;}
      .body{color:#111827;font-size:15px;line-height:1.6;}
      .hr{border:none;border-top:1px solid #e5e7eb;margin:20px 0;}
      .footer{color:#6b7280;font-size:12px;}
    </style>
  </head>
  <body class="wrapper">
    <div class="card">
      <div class="brand">Cyber Kingdom of Christ</div>
      <div class="meta">${new Date().toUTCString()}</div>
      <div class="body">
        <p>${greeting}</p>
        <p>${body}</p>
      </div>
      <div class="hr"></div>
      <div class="footer">
        Sent via CyberKingdomOfChrist.org
      </div>
    </div>
  </body>
</html>`;
}
