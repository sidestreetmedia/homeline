/** Tiny TeXML builder. Every value is escaped exactly once. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const VOICE = 'Polly.Joanna-Neural';
const HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';

export const say = (text: string, voice?: string) =>
  `<Say${voice ? ` voice="${xmlEscape(voice)}"` : ''}>${xmlEscape(text)}</Say>`;

export function hangupResponse(message: string): string {
  return `${HEAD}<Response>${say(message)}<Hangup/></Response>`;
}

/** Play (or speak) the listing, then prompt the caller to press 1. */
export function listingResponse(opts: { gatherAction: string; audioUrl?: string | null; fallbackText: string }): string {
  const body = opts.audioUrl ? `<Play>${xmlEscape(opts.audioUrl)}</Play>` : say(opts.fallbackText, VOICE);
  return (
    `${HEAD}<Response>` +
    `<Gather input="dtmf" numDigits="1" validDigits="1" timeout="8" action="${xmlEscape(opts.gatherAction)}" method="POST">` +
    body +
    say('To receive details by text message, press 1 now.', VOICE) +
    `</Gather></Response>`
  );
}
