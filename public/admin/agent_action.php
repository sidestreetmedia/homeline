<?php
require __DIR__ . '/../../src/bootstrap.php';
$me = Auth::requireGod();
Auth::checkCsrf(post('csrf'));

$agentId = (int) post('agent_id');
$action  = post('action');

$agent = DB::one("SELECT * FROM agents WHERE id=:id AND is_god=0", [':id'=>$agentId]);
if (!$agent) { header('Location: /admin/index.php'); exit; }

if ($action === 'suspend') {
    DB::run("UPDATE agents SET status='suspended' WHERE id=:id", [':id'=>$agentId]);
    $msg = 'Agent suspended.';
} elseif ($action === 'activate') {
    DB::run("UPDATE agents SET status='active' WHERE id=:id", [':id'=>$agentId]);
    $msg = 'Agent reactivated.';
} else {
    $msg = '';
}

header('Location: /admin/index.php?ok=' . rawurlencode($msg));
