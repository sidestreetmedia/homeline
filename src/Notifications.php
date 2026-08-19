<?php
declare(strict_types=1);

final class Notifications
{
    public static function homeAdded(array $agent, array $listing): void
    {
        $price = self::money((int) Config::get('PRICE_CENTS', '500'));
        $grace = !empty($listing['skip_next_recurring'])
            ? "\nThe next monthly renewal is skipped for this home under the four-day grace window."
            : '';
        $body = implode("\n", [
            "Hi {$agent['full_name']},",
            '',
            'Your home has been published.',
            'Property: ' . address_label($listing),
            'New phone number: ' . ($listing['phone_number'] ?: 'Pending'),
            '',
            'Billing details:',
            "- {$price} first-month charge collected today",
            "- {$price} per active home at the monthly renewal",
            '- Current active homes: ' . Billing::activeHouseCount((int) $agent['id']),
            '- Paid-through date: ' . ($listing['active_until'] ?: 'Not available'),
        ]) . $grace . "\n\n— HomeLine\n";

        self::queue((string) $agent['email'], 'HomeLine: home published', $body);
    }

    public static function homeDeleted(array $agent, array $listing): void
    {
        $price = self::money((int) Config::get('PRICE_CENTS', '500'));
        $body = implode("\n", [
            "Hi {$agent['full_name']},",
            '',
            'Your home has been deleted.',
            'Property: ' . address_label($listing),
            'Released phone number: ' . ($listing['phone_number'] ?: 'Not available'),
            '',
            'Billing details:',
            '- The current paid period is not refunded.',
            "- The home has been removed from the future {$price}-per-home monthly count.",
            '- Remaining active homes: ' . Billing::activeHouseCount((int) $agent['id']),
            '- Previous paid-through date: ' . ($listing['active_until'] ?: 'Not available'),
            '',
            '— HomeLine',
        ]);

        self::queue((string) $agent['email'], 'HomeLine: home deleted', $body);
    }

    public static function callerRequested(array $agent, array $listing, string $callerNumber): void
    {
        $body = implode("\n", [
            "Hi {$agent['full_name']},",
            '',
            'A caller requested information about one of your homes.',
            'Property: ' . address_label($listing),
            'Listing phone number: ' . ($listing['phone_number'] ?: 'Not available'),
            'Caller telephone number: ' . $callerNumber,
            'Requested at: ' . gmdate('F j, Y \a\t g:i A') . ' UTC',
            '',
            '— HomeLine',
        ]);

        self::queue((string) $agent['email'], 'HomeLine: caller requested property details', $body);
    }

    private static function queue(string $to, string $subject, string $body): void
    {
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            error_log('Notification skipped: account does not have a valid email address.');
            return;
        }
        enqueue('send_email', ['to' => $to, 'subject' => $subject, 'body' => $body]);
    }

    private static function money(int $cents): string
    {
        return '$' . number_format($cents / 100, 2);
    }
}
