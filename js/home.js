import { html, useMemo } from './lib.js';
import { formatEventDate, formatTimeRange, relativeDayLabel } from './lib.js';
import { displayNameOf } from './store.js';
import { EVENT_TYPE_LABEL, eventTitle, nextEvent, AbsenceToggle } from './events.js';
import { CheckInPanel } from './checkin.js';
import { LoadingState, EmptyState } from './shell.js';

// Home stays deliberately simple: who you are, what's next, and the one action a member ever
// needs to take before an event ("I can't make it"). Everything else — the full list, admin
// management — is one tap away on Calendar rather than crowded in here. Check-in lands here at
// Step D; nothing else is planned for this screen at MVP.
export function HomeTab({ profile, canManage, events, loading, terms, absences, checkins, onNavigate }) {
  const next = useMemo(() => nextEvent(events), [events]);
  const myAbsence = useMemo(
    () => (next ? absences.find((a) => a.rehearsal_id === next.id && a.profile_id === profile.id) : null),
    [absences, next, profile.id],
  );
  const myCheckin = useMemo(
    () => (next ? checkins.find((c) => c.rehearsal_id === next.id && c.profile_id === profile.id) : null),
    [checkins, next, profile.id],
  );
  const term = useMemo(
    () => (next?.term_id ? terms.find((t) => t.id === next.term_id) : null),
    [terms, next],
  );

  const rel = next ? relativeDayLabel(next.rehearsal_date) : '';

  return html`
    <div class="tab-content">
      <h2 class="home-greeting">Hi ${displayNameOf(profile) || 'there'}</h2>

      ${loading ? html`<${LoadingState} label="Loading your next event…" />` : null}

      ${!loading && !next ? html`
        <${EmptyState}
          title="Nothing scheduled yet"
          body=${canManage
            ? 'Add an event on Calendar and it will show up here for everyone.'
            : 'Your next rehearsal will show up here as soon as it’s scheduled.'}
          action=${canManage
            ? html`<button class="btn btn-primary btn-sm" onClick=${() => onNavigate('calendar')}>Go to Calendar</button>`
            : null}
        />
      ` : null}

      ${!loading && next ? html`
        <div class="card next-event-card">
          <p class="next-event-label">${rel || 'Next up'}</p>
          <div class="next-event-title">${eventTitle(next)}</div>
          <div class="next-event-when">
            ${formatEventDate(next.rehearsal_date)}
            ${next.start_time ? html` · ${formatTimeRange(next.start_time, next.end_time)}` : null}
          </div>
          ${next.location ? html`<div class="next-event-where">${next.location}</div>` : null}
          <div class="next-event-tags">
            <span class="event-type-badge event-type-${next.event_type}">${EVENT_TYPE_LABEL[next.event_type]}</span>
            ${!next.counts_towards_attendance
              ? html`<span class="event-type-badge event-type-neutral">Doesn't count towards attendance</span>`
              : null}
            ${term ? html`<span class="event-type-badge event-type-neutral">${term.name}</span>` : null}
          </div>
          ${next.description ? html`<p class="event-description">${next.description}</p>` : null}
          <${CheckInPanel} event=${next} myCheckin=${myCheckin} myAbsence=${myAbsence} profileId=${profile.id} />
          ${myCheckin
            ? null
            : html`<${AbsenceToggle} event=${next} myAbsence=${myAbsence} profileId=${profile.id} />`}
        </div>

        <button class="btn btn-outline home-link-btn" onClick=${() => onNavigate('calendar')}>
          See the full calendar
        </button>
      ` : null}

      ${canManage ? html`
        <div class="home-admin">
          <p class="home-admin-title">Organiser shortcuts</p>
          <div class="home-admin-actions">
            <button class="btn btn-outline btn-sm" onClick=${() => onNavigate('calendar')}>Manage events</button>
            <button class="btn btn-outline btn-sm" onClick=${() => onNavigate('more')}>Approve members</button>
          </div>
        </div>
      ` : null}
    </div>
  `;
}
