<?php
require __DIR__ . '/../src/bootstrap.php';
Auth::start();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    view('login', [], 'Sign in — HomeLine');
    return;
}

Auth::checkCsrf(post('csrf'));
$agent = Auth::attempt((string) post('email'), (string) post('password'));
if (!$agent) {
    view('login', ['error' => 'Incorrect email or password.'], 'Sign in — HomeLine');
    return;
}
header('Location: ' . ((int)$agent['is_god'] === 1 ? '/admin/index.php' : '/dashboard.php'));
