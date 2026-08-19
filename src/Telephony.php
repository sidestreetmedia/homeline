<?php
declare(strict_types=1);

/**
 * Telnyx Numbers, Messaging, and TeXML support.
 *
 * Telnyx does not publish a first-party PHP SDK, so this service uses the
 * documented v2 REST endpoints through the app's small cURL wrapper.
 */
final class Telephony
{
    private const API_BASE = 'https://api.telnyx.com/v2';

    /**
     * Search US local inventory by area code, requiring both voice and SMS.
     * @return array<int,array{phone:string,friendly:string,locality:?string,region:?string}>
     */
    public static function searchLocal(string $areaCode, int $limit = 10): array
    {
        $result = self::api('GET', '/available_phone_numbers', [
            'filter' => [
                'country_code'              => 'US',
                'national_destination_code' => $areaCode,
                'phone_number_type'          => 'local',
                'features'                   => ['voice', 'sms'],
                'limit'                      => max(1, min($limit, 50)),
                'best_effort'                => 'false',
            ],
        ]);

        $out = [];
        foreach (($result['data'] ?? []) as $number) {
            $phone = (string) ($number['phone_number'] ?? '');
            if ($phone === '') {
                continue;
            }
            $locality = null;
            $region = null;
            foreach (($number['region_information'] ?? []) as $info) {
                $type = (string) ($info['region_type'] ?? '');
                $name = (string) ($info['region_name'] ?? '');
                if ($name === '') {
                    continue;
                }
                if (in_array($type, ['rate_center', 'locality', 'city'], true)) {
                    $locality = $locality ?: $name;
                }
                if (in_array($type, ['state', 'administrative_area'], true)) {
                    $region = $region ?: $name;
                }
            }
            $out[] = [
                'phone'    => $phone,
                'friendly' => self::formatPhone($phone),
                'locality' => $locality,
                'region'   => $region,
            ];
        }
        return $out;
    }

    /**
     * Order a number and attach it to the configured TeXML application and
     * messaging profile.
     * @return array{number_id:?string,order_id:string,phone:string}
     */
    public static function purchase(string $phoneE164): array
    {
        $result = self::api('POST', '/number_orders', [], [
            'phone_numbers'        => [['phone_number' => $phoneE164]],
            'connection_id'        => Config::require('TELNYX_TEXML_APP_ID'),
            'messaging_profile_id' => Config::require('TELNYX_MESSAGING_PROFILE_ID'),
            'customer_reference'   => 'homeline:' . $phoneE164,
        ]);
        $orderId = (string) ($result['data']['id'] ?? '');
        if ($orderId === '') {
            throw new RuntimeException('Telnyx accepted the request but did not return an order ID.');
        }

        // Quickship US numbers normally appear immediately. Resolve the owned
        // number resource ID so deletion can release it directly. If activation
        // is still pending, deletion will resolve it from E.164 later.
        $numberId = null;
        for ($attempt = 0; $attempt < 4 && $numberId === null; $attempt++) {
            if ($attempt > 0) {
                usleep(350000);
            }
            $numberId = self::ownedNumberId($phoneE164);
        }
        return ['number_id' => $numberId, 'order_id' => $orderId, 'phone' => $phoneE164];
    }

    /** Release an owned number from the Telnyx account. */
    public static function release(?string $numberId, string $phoneE164): void
    {
        $id = $numberId ?: self::ownedNumberId($phoneE164);
        if (!$id) {
            throw new RuntimeException("Could not resolve Telnyx number {$phoneE164} for release.");
        }
        self::api('DELETE', '/phone_numbers/' . rawurlencode($id));
    }

    public static function sendSms(string $to, string $from, string $body): string
    {
        $result = self::api('POST', '/messages', [], [
            'to' => $to,
            'from' => $from,
            'text' => $body,
            'type' => 'SMS',
        ]);
        $id = (string) ($result['data']['id'] ?? '');
        if ($id === '') {
            throw new RuntimeException('Telnyx did not return a message ID.');
        }
        return $id;
    }

    /**
     * Verify a Telnyx webhook over the exact raw request body. Verification is
     * skipped only for local development when TELNYX_PUBLIC_KEY is unset.
     */
    public static function verifyWebhook(string $rawBody): bool
    {
        $publicKey = trim((string) Config::get('TELNYX_PUBLIC_KEY', ''));
        if ($publicKey === '') {
            return true;
        }
        $signature = (string) ($_SERVER['HTTP_TELNYX_SIGNATURE_ED25519'] ?? '');
        $timestamp = (string) ($_SERVER['HTTP_TELNYX_TIMESTAMP'] ?? '');
        if ($signature === '' || $timestamp === '' || !ctype_digit($timestamp)) {
            return false;
        }
        if (abs(time() - (int) $timestamp) > 300) {
            return false;
        }
        if (!function_exists('sodium_crypto_sign_verify_detached')) {
            error_log('Telnyx webhook verification requires ext-sodium.');
            return false;
        }

        $key = self::decodePublicKey($publicKey);
        $sig = base64_decode($signature, true);
        if ($key === null || $sig === false) {
            return false;
        }
        return sodium_crypto_sign_verify_detached($sig, $timestamp . '|' . $rawBody, $key);
    }

    private static function ownedNumberId(string $phoneE164): ?string
    {
        $result = self::api('GET', '/phone_numbers', [
            'filter' => ['phone_number' => $phoneE164],
            'page' => ['size' => 1],
        ]);
        $first = $result['data'][0] ?? null;
        return is_array($first) && !empty($first['id']) ? (string) $first['id'] : null;
    }

    /** @return array<string,mixed> */
    private static function api(string $method, string $path, array $query = [], ?array $payload = null): array
    {
        $url = self::API_BASE . $path;
        if ($query) {
            $url .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
        }
        $body = $payload === null ? null : json_encode($payload, JSON_UNESCAPED_SLASHES);
        if ($payload !== null && $body === false) {
            throw new RuntimeException('Could not encode Telnyx request.');
        }
        $response = Http::request($method, $url, [
            'Authorization' => 'Bearer ' . Config::require('TELNYX_API_KEY'),
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
        ], $body, 30);
        $json = Http::json($response);
        if ($response['status'] < 200 || $response['status'] >= 300) {
            $detail = $json['errors'][0]['detail'] ?? $json['errors'][0]['title'] ?? 'Telnyx request failed';
            throw new RuntimeException((string) $detail . " (HTTP {$response['status']})");
        }
        return $json;
    }

    private static function decodePublicKey(string $value): ?string
    {
        if (str_contains($value, 'BEGIN PUBLIC KEY')) {
            $value = preg_replace('/-----[^-]+-----|\s+/', '', $value) ?? '';
            $der = base64_decode($value, true);
            if ($der !== false && strlen($der) >= SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
                return substr($der, -SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES);
            }
            return null;
        }
        $decoded = base64_decode($value, true);
        if ($decoded !== false && strlen($decoded) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES) {
            return $decoded;
        }
        return strlen($value) === SODIUM_CRYPTO_SIGN_PUBLICKEYBYTES ? $value : null;
    }

    private static function formatPhone(string $phone): string
    {
        $digits = preg_replace('/\D/', '', $phone) ?? '';
        if (strlen($digits) === 11 && $digits[0] === '1') {
            return sprintf('(%s) %s-%s', substr($digits, 1, 3), substr($digits, 4, 3), substr($digits, 7, 4));
        }
        return $phone;
    }
}
