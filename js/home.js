import { html, useMemo } from './lib.js';
import { formatDateRail, formatDayMonthLong, formatWeekdayLong, formatTimeRange,
  relativeDayLabel, todayStr } from './lib.js';
import { EVENT_TYPE_LABEL, nextEvent, AbsenceToggle } from './events.js';
import { CheckInPanel, AttendanceStatus, isCheckInDay } from './checkin.js';
import { IconMegaphone } from './icons.js';
import { LoadingState, EmptyState } from './shell.js';

// Home follows the mockup's Option B: the date is the loudest thing on the screen, set as a big
// numeral beside the details rather than inside a coloured card. Everything a member does about
// the next event happens in this one block.
//
// Not here, deliberately — the two blocks Option B shows below the note band are both previously
// deferred work: "TERM 3 / 8 of 9 eligible rehearsals / 89% attendance / usually 2 minutes early"
// is Checkpoint 10's attendance visual plus punctuality tiers, and "LATEST RECAP" is Checkpoint
// 13 (and needs the song repertoire). So this screen is shorter than the mockup on purpose.
export function HomeTab({ profile, events, loading, terms, absences, checkins, onNavigate }) {
  const next = useMemo(() => nextEvent(events), [events]);
  const myAbsence = useMemo(
    () => (next ? absences.find((a) => a.rehearsal_id === next.id && a.profile_id === profile.id) : null),
    [absences, next, profile.id],
  );
  const myCheckin = useMemo(
    () => (next ? checkins.find((c) => c.rehearsal_id === next.id && c.profile_id === profile.id) : null),
    [checkins, next, profile.id],
  );

  if (loading) {
    return html`
      <div class="tab-content">
        <${LoadingState} label="Loading your next event…" />
      </div>
    `;
  }

  if (!next) {
    return html`
      <div class="tab-content">
        <${EmptyState}
          title="Nothing scheduled yet"
          body="Your next rehearsal will show up here as soon as it’s scheduled."
        />
      </div>
    `;
  }

  const rail = formatDateRail(next.rehearsal_date);
  const today = next.rehearsal_date === todayStr();
  // "Next rehearsal" / "Tonight's performance" — the label names the kind of thing it is, so the
  // eyebrow does the work the old relative-day pill used to.
  const kind = (EVENT_TYPE_LABEL[next.event_type] || 'event').toLowerCase();
  const eyebrow = next.title
    ? (today ? `Today · ${kind}` : `Next up · ${kind}`)
    : (today ? `Today's ${kind}` : `Next ${kind}`);
  const rel = relativeDayLabel(next.rehearsal_date);

  return html`
    <div class="tab-content">
      <div class="next-block">
        <div class="bigdate" aria-hidden="true">
          <span class="bigdate-day">${rail.day}</span>
          <span class="bigdate-num">${rail.date.split(' ')[0]}</span>
        </div>
        <div class="next-info">
          <p class="eyebrow-sm">${eyebrow}</p>
          <p class="next-title">
            ${next.title || `${formatWeekdayLong(next.rehearsal_date)} ${formatDayMonthLong(next.rehearsal_date)}`}
          </p>
          ${next.title ? html`
            <p class="next-time">
              ${formatWeekdayLong(next.rehearsal_date)} ${formatDayMonthLong(next.rehearsal_date)}
            </p>
          ` : null}
          ${next.start_time
            ? html`<p class="next-time">${formatTimeRange(next.start_time, next.end_time)}</p>`
            : null}
          ${next.location ? html`<p class="next-loc">${next.location}</p>` : null}
          ${rel && !today ? html`<p class="next-rel">${rel}</p>` : null}

          <div class="next-actions">
            <${AttendanceStatus} event=${next} myCheckin=${myCheckin} myAbsence=${myAbsence} />
            <${CheckInPanel} event=${next} myCheckin=${myCheckin} myAbsence=${myAbsence}
              profileId=${profile.id} />
            ${myCheckin
              ? null
              : html`<${AbsenceToggle} event=${next} myAbsence=${myAbsence} profileId=${profile.id} />`}
          </div>
        </div>
      </div>

      ${next.description ? html`
        <div class="note-band">
          <span class="note-band-icon"><${IconMegaphone} size=${20} /></span>
          <div>
            <p class="eyebrow-sm">${isCheckInDay(next) ? 'Tonight' : 'Note'}</p>
            <p class="note-band-body">${next.description}</p>
          </div>
        </div>
      ` : null}

      <hr class="home-rule" />

      <button class="btn btn-outline home-link-btn" onClick=${() => onNavigate('calendar')}>
        See the full calendar
      </button>

    </div>
  `;
}
