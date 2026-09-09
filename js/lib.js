// Single point of truth for our two CDN dependencies (no npm/build step on this machine —
// see README.md for why plain ESM imports were chosen over a bundler).
import { h, render, Fragment } from 'https://esm.sh/preact@10.23.1';
import { useState, useEffect, useRef, useMemo, useCallback } from 'https://esm.sh/preact@10.23.1/hooks';
import htm from 'https://esm.sh/htm@3.1.1';

export { h, render, Fragment, useState, useEffect, useRef, useMemo, useCallback };
export const html = htm.bind(h);

// A Date's own toISOString() converts to UTC, which silently shifts the calendar date for
// anyone not near UTC+0 — for Melbourne (UTC+10/11) it rolls every date back by one. Every
// "what calendar date is this" conversion in this app must go through local components instead.
const pad2 = (n) => String(n).padStart(2, '0');
export const localDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const todayStr = () => localDateStr(new Date());

// Punctuality tier for a check-in vs. the rehearsal's own start_time: on time or early = green,
// up to 10 minutes late = orange, later than that = red. `null` when the rehearsal has no
// start_time set — nothing to judge lateness against, so the UI should skip the badge entirely
// rather than guess. Shared between rehearsals.js (showing your own tier) and leaderboard.js
// (aggregating everyone's tiers), so it lives here rather than being duplicated in both.
export function checkinTier(rehearsal, checkedInAt) {
  if (!rehearsal.start_time) return null;
  const start = new Date(`${rehearsal.rehearsal_date}T${rehearsal.start_time}`);
  const minutesLate = (new Date(checkedInAt) - start) / 60000;
  if (minutesLate <= 0) return 'green';
  if (minutesLate <= 10) return 'orange';
  return 'red';
}

// Same reason as localDateStr above, in the other direction: `new Date('2026-09-15')` is parsed
// as UTC midnight, which renders as the 14th anywhere behind UTC and can render as the 15th at
// a wrong local time everywhere else. Building from explicit components keeps a stored `date`
// column meaning exactly the calendar day it says.
export function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Tue 15 Sep" — day-of-week first because that's how the choir talks about rehearsals.
export function formatEventDate(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function formatEventDateLong(dateStr) {
  const d = parseLocalDate(dateStr);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Postgres `time` comes back as 'HH:MM:SS'. Render 12-hour with the am/pm only on the end of a
// range when both halves share it ("7:30 – 9:30pm"), which is how a rehearsal time reads.
function timeParts(t) {
  if (!t) return null;
  const [hStr, mStr] = t.split(':');
  const h24 = Number(hStr);
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { text: `${h12}:${mStr}`, suffix };
}

export function formatTime(t) {
  const p = timeParts(t);
  return p ? `${p.text}${p.suffix}` : '';
}

export function formatTimeRange(start, end) {
  const a = timeParts(start);
  const b = timeParts(end);
  if (!a) return '';
  if (!b) return `${a.text}${a.suffix}`;
  if (a.suffix === b.suffix) return `${a.text} – ${b.text}${b.suffix}`;
  return `${a.text}${a.suffix} – ${b.text}${b.suffix}`;
}

// "in 3 days" / "today" / "tomorrow" for the next-event card on Home. Whole calendar days
// apart, computed from local date strings so it never disagrees with the date shown next to it.
export function daysUntil(dateStr) {
  const then = parseLocalDate(dateStr);
  const now = parseLocalDate(todayStr());
  return Math.round((then - now) / 86400000);
}

export function relativeDayLabel(dateStr) {
  const n = daysUntil(dateStr);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n > 1 && n < 7) return `In ${n} days`;
  return '';
}
