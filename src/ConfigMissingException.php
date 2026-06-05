<?php
declare(strict_types=1);

// The ConfigMissingException class is defined alongside Config in Config.php.
// This file exists so the PSR-style autoloader can resolve the class by name
// even if Config.php hasn't been loaded yet.
require_once __DIR__ . '/Config.php';
