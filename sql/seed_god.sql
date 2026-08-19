-- Seed the initial God-mode account.
-- Login email: joshuakuhn@homeline.local  (change to a real address from God-mode/Stripe later)
-- The password hash below corresponds to the temp password delivered out of band.
-- Force a password change after first login is recommended.

INSERT INTO agents (email, password_hash, full_name, status, is_god)
VALUES (
    'joshuakuhn',
    '$2y$12$30FuFTZNoAoMSHQHIQSvVeeJ164Cw//1BGqMSP5SiwYz8Qc4ZNJsS',
    'Joshua Kuhn',
    'active',
    1
)
ON DUPLICATE KEY UPDATE
    is_god = 1;
