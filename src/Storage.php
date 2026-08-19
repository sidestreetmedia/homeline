<?php
declare(strict_types=1);

use Aws\S3\S3Client;

final class Storage
{
    private static ?S3Client $client = null;

    private static function client(): S3Client
    {
        if (self::$client instanceof S3Client) {
            return self::$client;
        }
        self::$client = new S3Client([
            'version'     => 'latest',
            'region'      => Config::get('AWS_REGION', 'us-east-1'),
            'credentials' => [
                'key'    => Config::require('AWS_ACCESS_KEY_ID'),
                'secret' => Config::require('AWS_SECRET_ACCESS_KEY'),
            ],
        ]);
        return self::$client;
    }

    private static function bucket(): string
    {
        return Config::require('S3_BUCKET');
    }

    /** Store audio bytes and return the S3 key. */
    public static function putAudio(string $key, string $bytes): string
    {
        self::client()->putObject([
            'Bucket'      => self::bucket(),
            'Key'         => $key,
            'Body'        => $bytes,
            'ContentType' => 'audio/mpeg',
        ]);
        return $key;
    }

    public static function delete(string $key): void
    {
        self::client()->deleteObject([
            'Bucket' => self::bucket(),
            'Key'    => $key,
        ]);
    }

    /** Presigned GET URL Telnyx can fetch during a call. */
    public static function presignedUrl(string $key, string $ttl = '+20 minutes'): string
    {
        $cmd = self::client()->getCommand('GetObject', [
            'Bucket' => self::bucket(),
            'Key'    => $key,
        ]);
        $req = self::client()->createPresignedRequest($cmd, $ttl);
        return (string) $req->getUri();
    }
}
