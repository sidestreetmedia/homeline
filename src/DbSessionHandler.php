<?php
declare(strict_types=1);

final class DbSessionHandler implements SessionHandlerInterface
{
    public function open(string $path, string $name): bool { return true; }
    public function close(): bool { return true; }

    public function read(string $id): string
    {
        $row = DB::one("SELECT payload FROM sessions WHERE id = :id", [':id' => $id]);
        return $row['payload'] ?? '';
    }

    public function write(string $id, string $data): bool
    {
        $agentId = $_SESSION['agent_id'] ?? null;
        DB::run(
            "INSERT INTO sessions (id, agent_id, payload, last_active)
             VALUES (:id, :a, :p, :t)
             ON DUPLICATE KEY UPDATE payload = VALUES(payload),
                                     agent_id = VALUES(agent_id),
                                     last_active = VALUES(last_active)",
            [':id' => $id, ':a' => $agentId, ':p' => $data, ':t' => time()]
        );
        return true;
    }

    public function destroy(string $id): bool
    {
        DB::run("DELETE FROM sessions WHERE id = :id", [':id' => $id]);
        return true;
    }

    public function gc(int $maxLifetime): int|false
    {
        $cut = time() - max($maxLifetime, 86400);
        DB::run("DELETE FROM sessions WHERE last_active < :c", [':c' => $cut]);
        return true;
    }
}
