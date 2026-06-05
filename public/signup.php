<?php
require __DIR__ . '/../src/bootstrap.php';
Auth::start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    view('signup', [], 'Sign up — HomeLine');
    return;
}

Auth::checkCsrf(post('csrf'));
$old = [
    'full_name' => post('full_name'),
    'company'   => post('company'),
    'email'     => post('email'),
];

try {
    $email = (string) post('email');
    $pass  = (string) post('password');
    $name  = (string) post('full_name');
    if (strlen($pass) < 8) {
        throw new RuntimeException('Password must be at least 8 characters.');
    }
    $agent = Auth::register($email, $pass, $name, post('company'));

    // Log them in.
    $_SESSION['agent_id'] = (int) $agent['id'];
    session_regenerate_id(true);

    // Create Stripe customer scaffold so we can immediately collect a card.
    try {
        Billing::ensureCustomer($agent);
    } catch (Throwable $e) {
        error_log('Stripe customer setup deferred: ' . $e->getMessage());
    }

    // Send them straight to add a card — required before publishing a home.
    header('Location: /billing.php');
    exit;
} catch (Throwable $e) {
    view('signup', ['error' => $e->getMessage(), 'old' => $old], 'Sign up — HomeLine');
}
