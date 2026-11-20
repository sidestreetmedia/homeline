import type { Agent, Env, Listing } from '../env';
import type { Config } from '../lib/config';
import { longDateTime } from '../lib/dates';
import { isEmail } from './aws';
import { Billing } from './billing';
import { enqueue } from './jobs';

export function addressLabel(l: Pick<Listing, 'address_line1' | 'address_line2' | 'city' | 'state' | 'postal_code'>): string {
  return [l.address_line1, l.address_line2, `${l.city}, ${l.state} ${l.postal_code}`.trim()].filter(Boolean).join(', ');
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function queue(env: Env, to: string, subject: string, body: string): Promise<void> {
  if (!isEmail(to)) {
    console.warn('Notification skipped: account does not have a valid email address.');
    return;
  }
  await enqueue(env, { type: 'send_email', to, subject, body });
}

export async function homeAdded(env: Env, config: Config, agent: Agent, listing: Listing): Promise<void> {
  const price = money(config.priceCents());
  const lines = [
    `Hi ${agent.full_name},`,
    '',
    'Your home has been published.',
    `Property: ${addressLabel(listing)}`,
    `New phone number: ${listing.phone_number || 'Pending'}`,
    '',
    'Billing details:',
    `- ${price} first-month charge collected today`,
    `- ${price} per active home at the monthly renewal`,
    `- Current active homes: ${await Billing.activeHouseCount(env.DB, agent.id)}`,
    `- Paid-through date: ${listing.active_until || 'Not available'}`,
  ];
  if (listing.skip_next_recurring) {
    lines.push('The next monthly renewal is skipped for this home under the four-day grace window.');
  }
  await queue(env, agent.email, 'HomeLine: home published', `${lines.join('\n')}\n\n— HomeLine\n`);
}

export async function homeDeleted(env: Env, config: Config, agent: Agent, listing: Listing): Promise<void> {
  const price = money(config.priceCents());
  const body = [
    `Hi ${agent.full_name},`,
    '',
    'Your home has been deleted.',
    `Property: ${addressLabel(listing)}`,
    `Released phone number: ${listing.phone_number || 'Not available'}`,
    '',
    'Billing details:',
    '- The current paid period is not refunded.',
    `- The home has been removed from the future ${price}-per-home monthly count.`,
    `- Remaining active homes: ${await Billing.activeHouseCount(env.DB, agent.id)}`,
    `- Previous paid-through date: ${listing.active_until || 'Not available'}`,
    '',
    '— HomeLine',
  ].join('\n');
  await queue(env, agent.email, 'HomeLine: home deleted', body);
}

export async function callerRequested(env: Env, agent: Agent, listing: Listing, callerNumber: string): Promise<void> {
  const body = [
    `Hi ${agent.full_name},`,
    '',
    'A caller requested information about one of your homes.',
    `Property: ${addressLabel(listing)}`,
    `Listing phone number: ${listing.phone_number || 'Not available'}`,
    `Caller telephone number: ${callerNumber}`,
    `Requested at: ${longDateTime(new Date())} UTC`,
    '',
    '— HomeLine',
  ].join('\n');
  await queue(env, agent.email, 'HomeLine: caller requested property details', body);
}
