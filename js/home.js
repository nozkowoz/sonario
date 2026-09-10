import { html, useMemo } from './lib.js';
import { formatDateRail, formatWeekdayLong, formatDayMonthLong, formatTimeRange,
  parseLocalDate, relativeDayLabel, todayStr } from './lib.js';
import { displayNameOf } from './store.js';
import { EVENT_TYPE_LABEL, nextEvent, currentTermOf, AbsenceToggle, RailRow } from './events.js';
import { CheckInPanel, AttendanceStatus, isCheckInDay } from './checkin.js';
import { IconMegaphone, IconPinFilled } from './icons.js';
import { LoadingState, EmptyState } from './shell.js';

// Home, rebuilt 2026-09-10 from Nina's Figma spec (and DESIGN-RULES.md, which wins where the two
// disagree): a purple block carrying identity, greeting and the next rehearsal, then pale
// lavender body content — MY TERM, then COMING UP.
//
// Not here, and why:
//  - LATEST RECAP needs `rehearsal_recaps`, which is an empty table with no authoring UI. It
//    stays off Home rather than being faked (DESIGN-RULES.md → Future functionality).
//  - The intended design's coral "Rehearsal room changed" notice is rendered NEUTRAL, because
//    the only thing the app can actually put in that slot is the organiser's ordinary note on
//    the event, and the rules reserve coral for a genuine disruption. Coral becomes correct once
//    a notices feature can mark something as one.

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

// "Last week of term" — pinned to Home as a heads-up.
//
// Anchored on the term's LAST ACTUAL EVENT rather than on `ends_on`. A term's end date is
// administrative (Term 3 2026 ends Friday 18 September) while the last rehearsal is the thing
// worth warning about (Tuesday 15th). Counting back a week from `ends_on` would mean a term whose
// final rehearsal sits well before its end date shows the notice after everyone's last chance to
// act on it.
//
// Derived entirely from terms + events, so there's no notices table behind this and nothing to
// author — it appears and disappears on its own.
function lastWeekNotice(term, events, today) {
  if (!term || today > term.ends_on) return null;

  const inTerm = events.filter((e) => e.term_id === term.id && e.status !== 'cancelled');
  if (!inTerm.length) return null;
  const last = inTerm.reduce((a, b) => (a.rehearsal_date >= b.rehearsal_date ? a : b));
  if (last.rehearsal_date < today) return null;   // the last one has already happened

  const daysAway = Math.round(
    (parseLocalDate(last.rehearsal_date) - parseLocalDate(today)) / 86400000,
  );
  if (daysAway > 7) return null;

  const kind = (EVENT_TYPE_LABEL[last.event_type] || 'event').toLowerCase();
  const when = daysAway === 0 ? 'Tonight' : `${formatWeekdayLong(last.rehearsal_date)} ${formatDayMonthLong(last.rehearsal_date)}`;
  return {
    title: 'Last week of term',
    body: `${when} is the final ${kind} of ${term.name}.`,
  };
}

// My Term. THE DENOMINATOR IS REHEARSALS THAT HAVE ALREADY HAPPENED, not everything scheduled in
// the term — in week 2 having attended both it reads 2/2, never 2/10. That's an explicit rule.
function termStats({ term, events, checkins, profileId }) {
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

export function HomeTab({ profile, events, loading, terms, absences, checkins, onNavigate,
  onOpenEvent }) {
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
    () => termStats({ term, events, checkins, profileId: profile.id }),
    [term, events, checkins, profile.id],
  );
  const termNotice = useMemo(() => lastWeekNotice(term, events, todayStr()), [term, events]);

  // Everything after the hero's own event, so the same rehearsal isn't listed twice.
  const upcoming = useMemo(() => {
    const today = todayStr();
    return events
      .filter((e) => e.rehearsal_date >= today && e.status !== 'cancelled' && e.id !== next?.id)
      .slice(0, 5);
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
                  <p class="next-loc"><${IconPinFilled} size=${11} />${next.location}</p>
                ` : null}
                <${AttendanceStatus} event=${next} myCheckin=${myCheckin} myAbsence=${myAbsence} />
                <${CheckInPanel} event=${next} myCheckin=${myCheckin} myAbsence=${myAbsence}
                  profileId=${profile.id} />
              </div>
            </div>
            ${myCheckin ? null : html`
              <div class="next-card-foot">
                <${AbsenceToggle} event=${next} myAbsence=${myAbsence} profileId=${profile.id} />
              </div>
            `}
          </div>
        ` : null}
      </div>

      ${termNotice ? html`
        <div class="notice-card notice-butter">
          <span class="notice-icon"><${IconMegaphone} size=${20} /></span>
          <div class="notice-text">
            <p class="notice-title">${termNotice.title}</p>
            <p class="notice-body">${termNotice.body}</p>
          </div>
        </div>
      ` : null}

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
        <div class="rail-list">
          ${upcoming.map((e) => html`
            <${RailRow} key=${e.id} event=${e} onOpen=${onOpenEvent} />
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
