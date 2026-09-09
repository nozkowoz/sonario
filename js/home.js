import { html, useMemo } from './lib.js';
import { formatEventDate, formatTimeRange, relativeDayLabel } from './lib.js';
import { displayNameOf } from './store.js';
import { EVENT_TYPE_LABEL, eventTitle, nextEvent, AbsenceToggle } from './events.js';
import { CheckInPanel, isCheckInDay, timeOfDay } from './checkin.js';
import { IconUsers } from './icons.js';
import { LoadingState } from './shell.js';

// Home stays deliberately simple: who you are, what's next, and the one action a member ever
// needs to take. The hero carries all of that in a single purple block — the state you're in
// *is* the headline, rather than something to read off a row of labels.
//
// Not here, deliberately: the attendance heart row and "89% attendance" from the mockup are
// Checkpoint 10 ("Choir in Full Voice"), and the green ON TIME pill is the punctuality tier work.
// Both need real attendance maths and both are explicitly deferred.
function heroState({ next, myCheckin, myAbsence, canManage }) {
  if (!next) {
    return {
      headline: 'Nothing scheduled',
      sub: canManage
        ? 'Add an event on Calendar and it will show up here for everyone.'
        : 'Your next rehearsal will show up here as soon as it’s scheduled.',
      quiet: true,
    };
  }

  const when = [
    relativeDayLabel(next.rehearsal_date) || formatEventDate(next.rehearsal_date),
    next.start_time ? formatTimeRange(next.start_time, next.end_time) : null,
  ].filter(Boolean).join(' · ');

  if (myCheckin) {
    return {
      headline: "You're here!",
      sub: myCheckin.checked_in_at ? `Checked in at ${timeOfDay(myCheckin.checked_in_at)}` : 'Checked in',
    };
  }
  if (myAbsence) {
    return {
      headline: eventTitle(next),
      sub: when,
      note: "You've told us you can't make this one.",
    };
  }
  return { headline: eventTitle(next), sub: when };
}

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

  const firstName = (displayNameOf(profile) || '').split(' ')[0];
  const state = heroState({ next, myCheckin, myAbsence, canManage });

  return html`
    <div class="tab-content">
      ${loading
        ? html`<${LoadingState} label="Loading your next event…" />`
        : html`
          <div class="hero ${state.quiet ? 'hero-quiet' : ''}">
            <p class="hero-eyebrow">Hi, ${firstName || 'there'} ♪</p>
            <h2 class="hero-headline">${state.headline}</h2>
            <p class="hero-sub">${state.sub}</p>
            ${next && next.location && !myCheckin
              ? html`<p class="hero-where">${next.location}</p>`
              : null}
            ${next && !myCheckin ? html`
              <div class="hero-tags">
                <span class="hero-tag">${EVENT_TYPE_LABEL[next.event_type]}</span>
                ${term ? html`<span class="hero-tag">${term.name}</span>` : null}
                ${!next.counts_towards_attendance
                  ? html`<span class="hero-tag">Doesn't count towards attendance</span>`
                  : null}
              </div>
            ` : null}
            ${state.note ? html`<p class="hero-note">${state.note}</p>` : null}
            ${next ? html`
              <${CheckInPanel} event=${next} myCheckin=${myCheckin} myAbsence=${myAbsence}
                profileId=${profile.id} variant="hero" />
              ${myCheckin
                ? null
                : html`<${AbsenceToggle} event=${next} myAbsence=${myAbsence} profileId=${profile.id}
                    variant="hero" />`}
            ` : null}
            ${!next && canManage ? html`
              <div class="hero-actions">
                <button class="btn btn-on-hero" onClick=${() => onNavigate('calendar')}>Go to Calendar</button>
              </div>
            ` : null}
          </div>
        `}

      ${next ? html`
        <button class="btn btn-outline home-link-btn" onClick=${() => onNavigate('calendar')}>
          ${isCheckInDay(next) ? 'See the full calendar' : 'See what else is coming up'}
        </button>
      ` : null}

      <div class="card promo-card">
        <span class="promo-icon"><${IconUsers} size=${22} /></span>
        <div>
          <p class="promo-title">Same voices.<br />Brighter together.</p>
          <p class="promo-body">See you at rehearsal!</p>
        </div>
      </div>

      ${canManage ? html`
        <div class="home-admin">
          <p class="eyebrow">Organiser shortcuts</p>
          <div class="home-admin-actions">
            <button class="btn btn-outline btn-sm" onClick=${() => onNavigate('calendar')}>Manage events</button>
            <button class="btn btn-outline btn-sm" onClick=${() => onNavigate('more')}>Approve members</button>
          </div>
        </div>
      ` : null}
    </div>
  `;
}
