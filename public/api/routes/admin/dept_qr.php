<?php
declare(strict_types=1);

/**
 * Generate a printable QR sheet for a single department.
 * Accessible to: production admins (manage_departments) AND any
 * dept_admin / dept_staff member of that specific department.
 */
function handle_dept_qr(): void {
    require_method('GET');
    $user = require_auth();

    $id = (int)($_GET['id'] ?? 0);
    if (!$id) json_error('Missing dept id', 400);

    $perms    = $user['permissions'] ?? [];
    $dept_ids = $user['dept_ids']    ?? [];
    $is_admin = in_array('manage_departments', $perms, true);
    $is_member = in_array($id, array_map('intval', $dept_ids), true);

    if (!$is_admin && !$is_member) {
        json_error('Forbidden', 403);
    }

    $stmt = db()->prepare('SELECT id, name, qr_code FROM departments WHERE id = ? LIMIT 1');
    $stmt->execute([$id]);
    $dept = $stmt->fetch();

    if (!$dept) json_error('Department not found', 404);

    // Backfill if missing (pre-migration row)
    if (empty($dept['qr_code'])) {
        $qr_code = bin2hex(random_bytes(12));
        db()->prepare('UPDATE departments SET qr_code = ? WHERE id = ?')->execute([$qr_code, $dept['id']]);
        $dept['qr_code'] = $qr_code;
    }

    $scheme    = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $host      = $_SERVER['HTTP_HOST'];
    $scan_url  = $scheme . '://' . $host . '/scan?qr=' . rawurlencode($dept['qr_code']);

    $use_lib = file_exists(__DIR__ . '/../../../../vendor/phpqrcode/qrlib.php');
    if ($use_lib) {
        require_once __DIR__ . '/../../../../vendor/phpqrcode/qrlib.php';
        ob_start();
        QRcode::png($scan_url, false, QR_ECLEVEL_M, 10, 2);
        $png = ob_get_clean();
        $src = 'data:image/png;base64,' . base64_encode($png);
    } else {
        $src = 'https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=' . urlencode($scan_url);
    }

    $name_esc = htmlspecialchars($dept['name'],  ENT_QUOTES, 'UTF-8');
    $link_esc = htmlspecialchars($scan_url, ENT_QUOTES, 'UTF-8');

    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');

    echo '<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Team QR — ' . $name_esc . '</title>
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
.dept-name { font-size: 2rem; font-weight: bold; letter-spacing: .02em; }
.dept-label { font-size: 1rem; color: #555; }
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
    <div class="dept-name">' . $name_esc . '</div>
    <div class="dept-label">Team</div>
    <img class="qr-img" src="' . $src . '" alt="QR code for ' . $name_esc . '">
    <div class="deep-link">' . $link_esc . '</div>
</div>
</body>
</html>';
    exit;
}
