/** All billing dates are UTC, matching the PHP app (date_default_timezone_set('UTC')). */

export function firstOfNextMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface GraceResult {
  withinGrace: boolean;
  /** Paid-through date (YYYY-MM-DD). */
  activeUntil: string;
}

/**
 * Grace rule: a home added within 4 days of the next 1st has its upfront charge
 * cover that renewal too, so one renewal is skipped and it stays live an extra month.
 */
export function graceFor(now: Date): GraceResult {
  const next = firstOfNextMonth(now);
  const wholeDays = Math.floor((next.getTime() - now.getTime()) / 86_400_000);
  const withinGrace = wholeDays <= 4;
  const until = withinGrace ? new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1)) : next;
  return { withinGrace, activeUntil: ymd(until) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function shortDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** e.g. "November 20, 2026 at 1:05 PM" (UTC). */
export function longDateTime(d: Date): string {
  const h = d.getUTCHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${hour12}:${min} ${h < 12 ? 'AM' : 'PM'}`;
}
