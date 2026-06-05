<?php
require __DIR__ . '/../src/bootstrap.php';
// Inbound SMS to a listing number: reply with the blurb (bonus path).
header('Content-Type: text/xml; charset=utf-8');
$to = $_POST['To'] ?? '';
$listing = DB::one("SELECT * FROM listings WHERE twilio_number=:n AND deleted_at IS NULL", [':n'=>$to]);
$xml = new SimpleXMLElement('<Response/>');
if ($listing) { $xml->addChild('Message', htmlspecialchars($listing['sms_blurb'], ENT_XML1)); }
echo $xml->asXML();
