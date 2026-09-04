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
