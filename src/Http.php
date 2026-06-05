<?php
declare(strict_types=1);

/**
 * Http — thin cURL wrapper. We use the official SDKs (Stripe/Twilio/AWS) via
 * Composer for the heavy lifting, but ElevenLabs has no first-party PHP SDK,
 * so its calls go through here.
 */
final class Http
{
    /**
     * @param array<string,string> $headers
     * @return array{status:int, body:string, raw:string}
     */
    public static function request(
        string $method,
        string $url,
        array $headers = [],
        ?string $body = null,
        int $timeout = 60
    ): array {
        $ch = curl_init($url);
        $hdr = [];
        foreach ($headers as $k => $v) {
            $hdr[] = "{$k}: {$v}";
        }
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER     => $hdr,
            CURLOPT_TIMEOUT        => $timeout,
            CURLOPT_CONNECTTIMEOUT => 15,
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($ch);
        if ($raw === false) {
            $err = curl_error($ch);
            curl_close($ch);
            throw new RuntimeException("HTTP request failed: {$err}");
        }
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return ['status' => $status, 'body' => $raw, 'raw' => $raw];
    }

    public static function json(array $resp): array
    {
        $d = json_decode($resp['body'], true);
        return is_array($d) ? $d : [];
    }
}
