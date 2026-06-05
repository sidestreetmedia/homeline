<?php
declare(strict_types=1);

final class ElevenLabs
{
    /**
     * Generate speech audio (MP3 bytes) for the given text.
     * Throws on failure so the job can retry.
     */
    public static function synthesize(string $text): string
    {
        $apiKey  = Config::require('ELEVENLABS_API_KEY');
        // One default voice for everyone. Configurable from god-mode.
        $voiceId = Config::get('ELEVENLABS_VOICE_ID', 'EXAVITQu4vr4xnSDxMaL'); // Sarah (default placeholder)
        $model   = Config::get('ELEVENLABS_MODEL', 'eleven_turbo_v2_5');

        $url = "https://api.elevenlabs.io/v1/text-to-speech/{$voiceId}";
        $payload = json_encode([
            'text'     => $text,
            'model_id' => $model,
            'voice_settings' => [
                'stability'        => 0.5,
                'similarity_boost' => 0.75,
            ],
        ], JSON_THROW_ON_ERROR);

        $resp = Http::request('POST', $url, [
            'xi-api-key'   => $apiKey,
            'Content-Type' => 'application/json',
            'Accept'       => 'audio/mpeg',
        ], $payload, 120);

        if ($resp['status'] < 200 || $resp['status'] >= 300) {
            throw new RuntimeException(
                "ElevenLabs error {$resp['status']}: " . substr($resp['body'], 0, 500)
            );
        }
        if ($resp['body'] === '') {
            throw new RuntimeException('ElevenLabs returned empty audio.');
        }
        return $resp['body']; // raw MP3 bytes
    }
}
