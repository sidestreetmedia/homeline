import type { Config } from '../lib/config';

/** Generate speech audio (MP3 bytes). Throws on failure so the queue retries. */
export async function synthesize(config: Config, text: string): Promise<ArrayBuffer> {
  const voiceId = config.get('ELEVENLABS_VOICE_ID', 'EXAVITQu4vr4xnSDxMaL');
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.require('ELEVENLABS_API_KEY'),
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: config.get('ELEVENLABS_MODEL', 'eleven_turbo_v2_5'),
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  const audio = await res.arrayBuffer();
  if (audio.byteLength === 0) throw new Error('ElevenLabs returned empty audio.');
  return audio;
}
