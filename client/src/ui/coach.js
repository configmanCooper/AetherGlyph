// coach.js (ui) — render a post-round Practice coaching report into the DOM.
//
// Pure presentation: it takes the report produced by the shared coaching reducer
// (shared/src/analytics/coach.js) and writes semantic HTML into a container. It
// uses icon + text (never colour alone) for the improvement/positive cues so the
// report is legible with reduced colour vision, and honours summary vs detailed.

const OUTCOME_LABEL = { win: 'Victory', loss: 'Defeat', draw: 'Draw' };

// Build the report HTML. `detail` is 'summary' (headline + two cues) or
// 'detailed' (adds the full metric breakdown). Assisted rounds are badged.
export function coachHtml(report, opts = {}) {
  if (!report) return '';
  const detail = opts.detail || 'detailed';
  const parts = [];
  parts.push('<div class="coach-report">');

  const diff = report.difficulty ? `${cap(report.difficulty)} AI` : 'Practice';
  parts.push(`<p class="cr-head"><span class="cr-outcome cr-${report.outcome}">${OUTCOME_LABEL[report.outcome] || 'Round'}</span> · ${escape(diff)}${report.assisted ? ' · <span class="cr-assist">assisted</span>' : ''}</p>`);

  parts.push('<ul class="cr-cues">');
  parts.push(`<li class="cr-improve"><span class="cr-ic" aria-hidden="true">▲</span><span class="cr-lbl">Improve</span> ${escape(report.recommendation)}</li>`);
  parts.push(`<li class="cr-good"><span class="cr-ic" aria-hidden="true">★</span><span class="cr-lbl">Keep it up</span> ${escape(report.reinforcement)}</li>`);
  parts.push('</ul>');

  if (detail === 'detailed' && Array.isArray(report.lines) && report.lines.length) {
    parts.push('<ul class="cr-lines">');
    for (const line of report.lines) parts.push(`<li>${escape(line)}</li>`);
    parts.push('</ul>');
  }

  if (report.assisted) {
    parts.push('<p class="cr-note">Template assistance was on, so this round is not counted in difficulty comparison stats.</p>');
  }
  parts.push('</div>');
  return parts.join('');
}

// Render into a container element (clears it first).
export function renderCoachReport(el, report, opts = {}) {
  if (!el) return;
  el.innerHTML = coachHtml(report, opts);
  el.classList.remove('hidden');
}

function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }
function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
