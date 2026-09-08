import { html, todayStr, checkinTier } from './lib.js';

// Punctuality qualifies once someone's checked in at least this many times, so one lucky early
// arrival on day one doesn't top the board.
const MIN_CHECKINS_FOR_PUNCTUALITY = 3;

export function Leaderboard({ rehearsals, checkins }) {
  const today = todayStr();
  const pastRehearsals = rehearsals.filter((r) => r.rehearsal_date < today);
  const totalPast = pastRehearsals.length;
  const pastById = new Map(pastRehearsals.map((r) => [r.id, r]));

  const byMember = {};
  checkins.forEach((c) => {
    const rehearsal = pastById.get(c.rehearsal_id);
    if (!rehearsal) return; // only past rehearsals count toward the boards
    if (!byMember[c.member_name]) byMember[c.member_name] = { attended: 0, green: 0, orange: 0, red: 0 };
    byMember[c.member_name].attended += 1;
    const tier = checkinTier(rehearsal, c.checked_in_at);
    if (tier) byMember[c.member_name][tier] += 1;
  });

  const attendanceBoard = Object.entries(byMember)
    .map(([name, s]) => ({ name, attended: s.attended, rate: totalPast ? s.attended / totalPast : 0 }))
    .sort((a, b) => b.attended - a.attended || b.rate - a.rate);

  const punctualityBoard = Object.entries(byMember)
    .map(([name, s]) => {
      const rated = s.green + s.orange + s.red;
      return { name, green: s.green, orange: s.orange, red: s.red, rated, greenRate: rated ? s.green / rated : 0 };
    })
    .filter((p) => p.rated >= MIN_CHECKINS_FOR_PUNCTUALITY)
    .sort((a, b) => b.greenRate - a.greenRate || b.rated - a.rated);

  return html`
    <div class="tab-content">
      <h2>Leaderboard</h2>
      ${totalPast === 0 ? html`<p class="empty-state">No past rehearsals yet — check in at a rehearsal to start building the leaderboard.</p>` : null}

      <h3 class="group-heading">Best attendance</h3>
      ${attendanceBoard.length === 0 ? html`<p class="empty-state">Nobody's checked in yet.</p>` : html`
        <div class="card">
          ${attendanceBoard.map((p, i) => html`
            <div key=${p.name} class="leaderboard-row">
              <span class="leaderboard-rank">${i + 1}</span>
              <span class="leaderboard-name">${p.name}</span>
              <span class="leaderboard-stat">${p.attended} / ${totalPast} (${Math.round(p.rate * 100)}%)</span>
            </div>
          `)}
        </div>
      `}

      <h3 class="group-heading">Most punctual</h3>
      ${punctualityBoard.length === 0 ? html`<p class="empty-state">Nobody's checked in to ${MIN_CHECKINS_FOR_PUNCTUALITY}+ rehearsals yet.</p>` : html`
        <div class="card">
          ${punctualityBoard.map((p, i) => html`
            <div key=${p.name} class="leaderboard-row">
              <span class="leaderboard-rank">${i + 1}</span>
              <span class="leaderboard-name">${p.name}</span>
              <span class="leaderboard-stat">${Math.round(p.greenRate * 100)}% on time<span class="leaderboard-tiers">🟢${p.green} 🟠${p.orange} 🔴${p.red}</span></span>
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}
