<?php
declare(strict_types=1);

// Look up a person by their QR token — used during checkout scanning
function handle_person_info(): void {
    require_method('GET');
    require_auth();

    $qr = trim($_GET['qr'] ?? '');
    if ($qr === '') json_error('qr required', 400);

    $stmt = db()->prepare(
        'SELECT id, display_name, qr_token FROM users WHERE qr_token = ? AND is_active = 1'
    );
    $stmt->execute([$qr]);
    $person = $stmt->fetch();

    if (!$person) json_error('Person not found', 404);

    $items = db()->prepare(
        'SELECT ei.id, ei.qr_code, ei.dept_label,
                CONCAT(et.name, \' #\', ei.item_number) AS name,
                et.category
         FROM equipment_items ei
         JOIN equipment_types et ON et.id = ei.equipment_type_id
         WHERE ei.current_person_id = ?
         ORDER BY et.name, ei.item_number'
    )->execute([(int)$person['id']])->fetchAll();

    foreach ($items as &$it) $it['id'] = (int)$it['id'];
    unset($it);

    json_ok([
        'person'    => ['id' => (int)$person['id'], 'display_name' => $person['display_name']],
        'items_out' => $items,
    ]);
}

// Returns the authenticated user's own QR token as a printable page
function handle_my_qr(): void {
    require_method('GET');
    $user = require_auth();

    $qr_token = $user['qr_token'] ?? null;
    if (!$qr_token) {
        $qr_token = ensure_user_qr_token((int)$user['id']);
    }

    $scheme   = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host     = $_SERVER['HTTP_HOST'];
    $scan_url = $scheme . '://' . $host . '/scan?qr=' . rawurlencode($qr_token);

    $use_lib = file_exists(__DIR__ . '/../../../vendor/phpqrcode/qrlib.php');
    if ($use_lib) {
        require_once __DIR__ . '/../../../vendor/phpqrcode/qrlib.php';
        ob_start();
        QRcode::png($scan_url, false, QR_ECLEVEL_M, 10, 2);
        $png = ob_get_clean();
        $src = 'data:image/png;base64,' . base64_encode($png);
    } else {
        $src = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' . urlencode($scan_url);
    }

    $name_esc = htmlspecialchars($user['display_name'], ENT_QUOTES, 'UTF-8');
    $link_esc = htmlspecialchars($scan_url, ENT_QUOTES, 'UTF-8');

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');

    echo '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>My QR — ' . $name_esc . '</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; background: #fff; }
.toolbar {
    display: flex; gap: 1rem; padding: 1rem;
    background: #f5f5f5; border-bottom: 1px solid #ddd; align-items: center;
}
.toolbar button {
    padding: .5rem 1.25rem; border: 1px solid #999; border-radius: 4px;
    background: #fff; cursor: pointer; font-size: .9rem;
}
.toolbar button:hover { background: #e8e8e8; }
.page {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; padding: 3rem 2rem; gap: 1.25rem;
}
.person-name { font-size: 2rem; font-weight: bold; }
.person-label { font-size: 1rem; color: #555; }
.qr-img { width: 10cm; height: 10cm; display: block; }
.deep-link { font-size: 11pt; color: #555; font-family: monospace; word-break: break-all; text-align: center; }
@media print { .toolbar { display: none; } .page { padding: 1cm; } }
</style>
</head>
<body>
<div class="toolbar">
    <button onclick="window.print()">Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
</div>
<div class="page">
    <div class="person-name">' . $name_esc . '</div>
    <div class="person-label">Personal QR</div>
    <img class="qr-img" src="' . $src . '" alt="QR code for ' . $name_esc . '">
    <div class="deep-link">' . $link_esc . '</div>
</div>
</body>
</html>';
    exit;
}

// Search staff by name — used in checkout person-selection step
function handle_person_search(): void {
    require_method('GET');
    require_auth();

    $q = trim($_GET['q'] ?? '');
    if ($q === '') {
        json_ok(['persons' => []]);
        return;
    }

    $like  = '%' . $q . '%';
    $rows  = db()->prepare(
        'SELECT id, display_name, qr_token FROM users
         WHERE is_active = 1 AND display_name LIKE ?
         ORDER BY display_name LIMIT 20'
    )->execute([$like])->fetchAll();

    foreach ($rows as &$r) $r['id'] = (int)$r['id'];
    unset($r);

    json_ok(['persons' => $rows]);
}
