<?php
declare(strict_types=1);

use Aws\Ses\SesClient;

final class Mailer
{
    private static ?SesClient $client = null;

    private static function client(): SesClient
    {
        if (self::$client instanceof SesClient) {
            return self::$client;
        }

        $credentials = [
            'key'    => Config::require('AWS_SES_ACCESS_KEY_ID'),
            'secret' => Config::require('AWS_SES_SECRET_ACCESS_KEY'),
        ];
        $token = trim((string) Config::get('AWS_SES_SESSION_TOKEN', ''));
        if ($token !== '') {
            $credentials['token'] = $token;
        }

        self::$client = new SesClient([
            'version'     => 'latest',
            'region'      => Config::require('AWS_SES_REGION'),
            'credentials' => $credentials,
        ]);
        return self::$client;
    }

    public static function send(string $to, string $subject, string $body): void
    {
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('Notification recipient is not a valid email address.');
        }

        $fromEmail = Config::require('AWS_SES_FROM_EMAIL');
        if (!filter_var($fromEmail, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('Configured notification sender is not a valid email address.');
        }

        $fromName = preg_replace('/[\r\n]+/', ' ', trim((string) Config::get('AWS_SES_FROM_NAME', 'HomeLine')));
        $source = $fromName !== '' ? sprintf('%s <%s>', $fromName, $fromEmail) : $fromEmail;
        $params = [
            'Source'      => $source,
            'Destination' => ['ToAddresses' => [$to]],
            'Message'     => [
                'Subject' => ['Charset' => 'UTF-8', 'Data' => $subject],
                'Body'    => ['Text' => ['Charset' => 'UTF-8', 'Data' => $body]],
            ],
        ];

        $replyTo = trim((string) Config::get('AWS_SES_REPLY_TO_EMAIL', ''));
        if ($replyTo !== '') {
            if (!filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
                throw new InvalidArgumentException('Configured reply-to address is not a valid email address.');
            }
            $params['ReplyToAddresses'] = [$replyTo];
        }

        $configurationSet = trim((string) Config::get('AWS_SES_CONFIGURATION_SET', ''));
        if ($configurationSet !== '') {
            $params['ConfigurationSetName'] = $configurationSet;
        }

        self::client()->sendEmail($params);
    }
}
