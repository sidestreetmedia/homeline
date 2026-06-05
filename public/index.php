<?php
require __DIR__ . '/../src/bootstrap.php';
if (Auth::current()) { header('Location: /dashboard.php'); exit; }
view('home', [], 'HomeLine — listings that talk');
