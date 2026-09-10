import { html, useMemo } from './lib.js';
import { formatDateRail, formatWeekdayLong, formatTimeRange,
  parseLocalDate, relativeDayLabel, todayStr } from './lib.js';
import { displayNameOf } from './store.js';
import { EVENT_TYPE_LABEL, eventTitle, nextEvent, currentTermOf, AbsenceToggle } from './events.js';
import { CheckInPanel, AttendanceStatus, isCheckInDay } from './checkin.js';
import { IconMegaphone, IconPin, IconChevron } from './icons.js';
import { LoadingState, EmptyState } from './shell.js';

// Home, per Nina's 2026-09-10 mockup and DESIGN-RULES.md: a strong purple block at the top
// carrying identity, greeting and the next rehearsal, then pale-lavender body content in cards.
//
// Not here, and why: LATEST RECAP needs `rehearsal_recaps`, which has a table but no content and
// no authoring UI (Checkpoint 13). And the mockup's coral "Rehearsal room changed" notice is
// styled NEUTRAL here, because the rules reserve coral for genuine attention states and what the
// app actually has to put in that slot is the organiser's ordinary note on the event. Coral
// becomes correct once there's a notices feature that can mark something as a disruption.

const greetingFor = (d = new Date()) => {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

// At least this many timestamped check-ins before an "average" earns the name. Below it the rules
// require a dash rather than an invented figure.
const MIN_ARRIVALS_FOR_AVERAGE = 3;

const clockFromMinutes = (mins) => {
  const m = Math.round(mins);
  const h24 = Math.floor(m / 60) % 24;
  const mm = String(m % 60).padStart(2, '0');
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm}${h24 < 12 ? 'am' : 'pm'}`;
};

// My Term. THE DENOMINATOR IS REHEARSALS THAT HAVE ALREADY HAPPENED, not everything scheduled in
// the term — in week 2 having attended both it reads 2/2, never 2/10. That's an explicit rule.
function termStats({ term, events, checkins, absences, profileId }) {
  if (!term) return null;
  const today = todayStr();

  const soFar = events.filter((e) => e.term_id === term.id
    && e.counts_towards_attendance
    && e.status !== 'cancelled'
    && e.rehearsal_date < today);
  if (!soFar.length) return null;

  const ids = new Set(soFar.map((e) => e.id));
  const mine = checkins.filter((c) => c.profile_id === profileId && ids.has(c.rehearsal_id));

  // Average arrival as a clock time, which is what the label promises. Every rehearsal starts at
  // the same hour so averaging times of day is meaningful; if that stops being true this should
  // become an average offset from each event's own start time.
  const arrivals = mine
    .filter((c) => c.checked_in_at)
    .map((c) => { const d = new Date(c.checked_in_at); return d.getHours() * 60 + d.getMinutes(); });
  const avgArrival = arrivals.length >= MIN_ARRIVALS_FOR_AVERAGE
    ? clockFromMinutes(arrivals.reduce((a, b) => a + b, 0) / arrivals.length)
    : '—';

  return {
    attended: mine.length,
    soFar: soFar.length,
    pct: Math.round((mine.length / soFar.length) * 100),
    avgArrival,
  };
}

export function HomeTab({ profile, events, loading, terms, absences, checkins, onNavigate }) {
  const next = useMemo(() => nextEvent(events), [events]);
  const term = useMemo(() => currentTermOf(terms), [terms]);
  const myAbsence = useMemo(
    () => (next ? absences.find((a) => a.rehearsal_id === next.id && a.profile_id === profile.id) : null),
    [absences, next, profile.id],
  );
  const myCheckin = useMemo(
    () => (next ? checkins.find((c) => c.rehearsal_id === next.id && c.profile_id === profile.id) : null),
    [checkins, next, profile.id],
  );
  const stats = useMemo(
    () => termStats({ term, events, checkins, absences, profileId: profile.id }),
    [term, events, checkins, absences, profile.id],
  );

  // Everything after the hero's own event, so the same rehearsal isn't listed twice.
  const upcoming = useMemo(() => {
    const today = todayStr();
    return events
      .filter((e) => e.rehearsal_date >= today && e.status !== 'cancelled' && e.id !== next?.id)
      .slice(0, 3);
  }, [events, next]);

  const firstName = (displayNameOf(profile) || '').split(' ')[0];
  const rail = next ? formatDateRail(next.rehearsal_date) : null;
  const rel = next ? relativeDayLabel(next.rehearsal_date) : '';

  return html`
    <div class="tab-content home">
      <div class="home-top">
        <p class="home-greeting">${greetingFor()}${firstName ? `, ${firstName}` : ''}</p>

        ${loading ? html`<${LoadingState} label="Loading your next event…" />` : null}

        ${!loading && !next ? html`
          <div class="next-card">
            <p class="next-eyebrow">Next rehearsal</p>
            <p class="next-empty">Nothing is scheduled yet. Your next rehearsal will appear here.</p>
          </div>
        ` : null}

        ${!loading && next ? html`
          <div class="next-card">
            <div class="next-card-head">
              <p class="next-eyebrow">
                ${next.event_type === 'rehearsal'
                  ? 'Next rehearsal'
                  : `Next ${(EVENT_TYPE_LABEL[next.event_type] || 'event').toLowerCase()}`}
              </p>
              ${rel ? html`<p class="next-when">${rel}</p>` : null}
            </div>
            <div class="next-card-body">
              <div class="next-rail" aria-hidden="true">
                <span class="next-rail-day">${rail.day}</span>
                <span class="next-rail-num">${parseLocalDate(next.rehearsal_date).getDate()}</span>
                <span class="next-rail-mon">${rail.date.split(' ')[1]}</span>
              </div>
              <div class="next-detail">
                ${next.title ? html`<p class="next-title">${next.title}</p>` : null}
                ${next.start_time
                  ? html`<p class="next-time">${formatTimeRange(next.start_time, next.end_time)}</p>`
                  : null}
                ${next.location ? html`
                  <p class="next-loc"><${IconPin} size=${17} />${next.location}</p>
                ` : null}
                <${AttendanceStatus} event=${next} myCheckin=${myCheckin} myAbsence=${myAbsence} />
                <${CheckInPanel} event=${next} myCheckin=${myCheckin} myAbsence=${myAbsence}
                  profileId=${profile.id} />
                ${myCheckin
                  ? null
                  : html`<${AbsenceToggle} event=${next} myAbsence=${myAbsence} profileId=${profile.id} />`}
              </div>
            </div>
          </div>
        ` : null}
      </div>

      ${next && next.description ? html`
        <div class="notice-card">
          <span class="notice-icon"><${IconMegaphone} size=${20} /></span>
          <div class="notice-text">
            <p class="notice-title">
              ${isCheckInDay(next) ? 'Tonight' : formatWeekdayLong(next.rehearsal_date)}
            </p>
            <p class="notice-body">${next.description}</p>
          </div>
        </div>
      ` : null}

      ${stats ? html`
        <div class="card term-stats">
          <div class="term-stats-head">
            <h3 class="term-stats-title">My term</h3>
            <span class="term-stats-name">${term.name}</span>
          </div>
          <div class="term-stats-row">
            <div class="stat">
              <p class="stat-value">${stats.attended} / ${stats.soFar}</p>
              <p class="stat-label">rehearsals so far</p>
            </div>
            <div class="stat">
              <p class="stat-value">${stats.pct}%</p>
              <p class="stat-label">attendance</p>
            </div>
            <div class="stat">
              <p class="stat-value">${stats.avgArrival}</p>
              <p class="stat-label">avg. arrival</p>
            </div>
          </div>
          <div class="stat-bar" role="img"
            aria-label=${`${stats.pct}% attendance, ${stats.attended} of ${stats.soFar} rehearsals so far`}>
            <span style=${{ width: `${stats.pct}%` }}></span>
          </div>
        </div>
      ` : null}

      ${upcoming.length ? html`
        <div class="section-header home-section">
          <h3 class="home-section-title">Coming up</h3>
          <button class="btn-quiet" onClick=${() => onNavigate('calendar')}>See all</button>
        </div>
        <div class="event-list">
          ${upcoming.map((e) => html`
            <button key=${e.id} class="mini-row" onClick=${() => onNavigate('calendar')}>
              <span class="mini-rail" aria-hidden="true">
                <span class="mini-rail-day">${formatDateRail(e.rehearsal_date).day}</span>
                <span class="mini-rail-date">${formatDateRail(e.rehearsal_date).date}</span>
              </span>
              <span class="mini-body">
                <span class="mini-title">${eventTitle(e)}</span>
                ${e.start_time
                  ? html`<span class="mini-meta">${formatTimeRange(e.start_time, e.end_time)}</span>`
                  : null}
                ${e.location ? html`<span class="mini-meta">${e.location}</span>` : null}
              </span>
              <span class="mini-chev"><${IconChevron} size=${18} /></span>
            </button>
          `)}
        </div>
      ` : null}

      ${!loading && !next && !stats ? html`
        <${EmptyState} title="Nothing scheduled yet"
          body="Your next rehearsal will show up here as soon as it’s scheduled." />
      ` : null}
    </div>
  `;
}
