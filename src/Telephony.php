<?php
declare(strict_types=1);

use Twilio\Rest\Client as TwilioClient;

final class Telephony
{
    private static ?TwilioClient $client = null;

    private static function client(): TwilioClient
    {
        if (self::$client instanceof TwilioClient) {
            return self::$client;
        }
        self::$client = new TwilioClient(
            Config::require('TWILIO_ACCOUNT_SID'),
            Config::require('TWILIO_AUTH_TOKEN')
        );
        return self::$client;
    }

    /**
     * Search available local numbers by area code.
     * @return array<int,array{phone:string,friendly:string,locality:?string,region:?string}>
     */
    public static function searchLocal(string $areaCode, int $limit = 10): array
    {
        $opts = ['areaCode' => (int) $areaCode, 'voiceEnabled' => true, 'smsEnabled' => true];
        $numbers = self::client()->availablePhoneNumbers('US')
            ->local
            ->read($opts, $limit);

        $out = [];
        foreach ($numbers as $n) {
            $out[] = [
                'phone'    => $n->phoneNumber,
                'friendly' => $n->friendlyName,
                'locality' => $n->locality ?? null,
                'region'   => $n->region ?? null,
            ];
        }
        return $out;
    }

    /**
     * Purchase a number and point its voice + SMS webhooks at our app.
     * @return array{sid:string, phone:string}
     */
    public static function purchase(string $phoneE164): array
    {
        $base = rtrim(Config::require('APP_BASE_URL'), '/');
        $incoming = self::client()->incomingPhoneNumbers->create([
            'phoneNumber'        => $phoneE164,
            'voiceUrl'           => "{$base}/twilio_voice.php",
            'voiceMethod'        => 'POST',
            'smsUrl'             => "{$base}/twilio_sms.php",
            'smsMethod'          => 'POST',
            'statusCallback'     => "{$base}/twilio_status.php",
        ]);
        return ['sid' => $incoming->sid, 'phone' => $incoming->phoneNumber];
    }

    public static function release(string $numberSid): void
    {
        self::client()->incomingPhoneNumbers($numberSid)->delete();
    }

    public static function sendSms(string $to, string $from, string $body): string
    {
        $msg = self::client()->messages->create($to, [
            'from' => $from,
            'body' => $body,
        ]);
        return $msg->sid;
    }
}
