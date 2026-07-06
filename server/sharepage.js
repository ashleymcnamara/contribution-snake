// HTML for /r/<replayId>: OG meta tags for link-preview scrapers, and an
// instant redirect into the app's spectate mode for humans.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function renderSharePage({ id, name, score, mode, day, origin }) {
  const title = `${name} scored ${score} in Contribution Snake`;
  const modeLine = mode === 'daily' ? `Daily challenge, ${day}`
    : mode === 'graph' ? `@${day}'s contribution graph` : 'Classic mode';
  const description = `${modeLine}. Watch the replay and try to beat it.`;
  const image = `${origin}/api/og/${id}.png`;
  const watchUrl = `${origin}/?watch=${id}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${esc(origin)}/r/${esc(id)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">
  <meta http-equiv="refresh" content="0;url=${esc(watchUrl)}">
</head>
<body>
  <p><a href="${esc(watchUrl)}">Watch the replay</a></p>
</body>
</html>`;
}
