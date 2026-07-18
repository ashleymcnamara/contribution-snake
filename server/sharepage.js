// HTML for /r/<replayId>: personalized link-preview metadata plus an instant
// redirect into either a live Daily ghost challenge or replay spectating.
import {
  SHARE_SKINS, dailyChallengeNumber, normalizeShareProfile,
} from '../src/social.js';
import { dailyObjectiveProgress } from '../src/game/daily.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function renderSharePage({
  id,
  name,
  score,
  mode,
  day,
  origin,
  final = null,
  rank = null,
  shareProfile = null,
  challengeCurrent = false,
}) {
  const isDaily = mode === 'daily';
  const profile = normalizeShareProfile(shareProfile);
  const dailyNumber = isDaily ? dailyChallengeNumber(day) : null;
  const objective = isDaily && final ? dailyObjectiveProgress(final) : null;
  const title = isDaily
    ? `${name}'s GitSnake Daily #${dailyNumber} — ${score} pts`
    : `${name} scored ${score} in GitSnake`;
  const modeLine = mode === 'graph' ? `@${day}'s contribution graph` : 'Classic mode';
  const dailyDetails = isDaily
    ? [
      rank ? `#${rank} ${challengeCurrent ? 'today' : 'on this Daily'}` : null,
      final ? `${final.bestStreak} best streak` : null,
      objective?.label ? `${objective.complete ? 'Completed' : 'Tried'}: ${objective.label}` : null,
      `Style: ${SHARE_SKINS[profile.skinId]}`,
    ].filter(Boolean).join(' · ')
    : null;
  const description = isDaily
    ? `${dailyDetails}. Open the result and try to beat it.`
    : `${modeLine}. Watch the replay and try to beat it.`;
  const image = `${origin}/api/og/${encodeURIComponent(id)}.png`;
  const destination = isDaily && challengeCurrent
    ? `${origin}/?daily=1&ghost=${encodeURIComponent(id)}`
    : `${origin}/?watch=${encodeURIComponent(id)}`;
  const imageAlt = isDaily
    ? `${name}'s spoiler-free Daily #${dailyNumber} scorecard`
    : `${name}'s final GitSnake board`;
  const linkLabel = isDaily && challengeCurrent ? 'Race the Daily ghost' : 'Watch the replay';

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
  <meta property="og:image:alt" content="${esc(imageAlt)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  <meta name="twitter:image" content="${esc(image)}">
  <meta name="twitter:image:alt" content="${esc(imageAlt)}">
  <meta http-equiv="refresh" content="0;url=${esc(destination)}">
</head>
<body>
  <p><a href="${esc(destination)}">${linkLabel}</a></p>
</body>
</html>`;
}
