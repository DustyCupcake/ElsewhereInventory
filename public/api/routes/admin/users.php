<?php
declare(strict_types=1);

function handle_list(): void {
    require_method('GET');
    require_permission('manage_users');

    $rows = db()->query(
        'SELECT id, username, display_name, role, is_active, created_at, last_login
         FROM users ORDER BY display_name'
    )->fetchAll();

    foreach ($rows as &$r) {
        $r['id']        = (int)$r['id'];
        $r['is_active'] = (bool)$r['is_active'];
    }
    unset($r);

    // Attach dept memberships
    $memberships = db()->query(
        'SELECT udr.user_id, udr.dept_id, udr.role AS dept_role, d.name AS dept_name
         FROM user_dept_roles udr JOIN departments d ON d.id = udr.dept_id'
    )->fetchAll();

    $by_user = [];
    foreach ($memberships as $m) {
        $by_user[$m['user_id']][] = [
            'dept_id'   => (int)$m['dept_id'],
            'dept_name' => $m['dept_name'],
            'role'      => $m['dept_role'],
        ];
    }
    foreach ($rows as &$r) {
        $r['dept_memberships'] = $by_user[$r['id']] ?? [];
    }
    unset($r);

    json_ok(['users' => $rows]);
}

function handle_create(): void {
    require_method('POST');
    require_permission('manage_users');
    verify_csrf();

    $b            = body();
    $username     = trim($b['username'] ?? '');
    $display_name = trim($b['display_name'] ?? '');
    $password     = $b['password'] ?? '';
    $role         = $b['role'] ?? 'dept_staff';

    if ($username === '' || $display_name === '' || strlen($password) < 8) {
        json_error('username, display_name, and password (min 8 chars) required');
    }

    $valid_roles = ['production_admin', 'production_staff', 'dept_admin', 'dept_staff'];
    if (!in_array($role, $valid_roles, true)) json_error('Invalid role');

    $hash = password_hash($password, PASSWORD_BCRYPT);

    try {
        db()->prepare(
            'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
        )->execute([$username, $display_name, $hash, $role]);
        $id = (int)db()->lastInsertId();
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) json_error('Username already exists', 409);
        throw $e;
    }

    // Add dept memberships if provided
    $dept_memberships = $b['dept_memberships'] ?? [];
    foreach ($dept_memberships as $m) {
        $dept_id   = (int)($m['dept_id'] ?? 0);
        $dept_role = $m['role'] ?? 'dept_staff';
        if (!$dept_id || !in_array($dept_role, ['dept_admin', 'dept_staff'], true)) continue;
        db()->prepare(
            'INSERT IGNORE INTO user_dept_roles (user_id, dept_id, role) VALUES (?, ?, ?)'
        )->execute([$id, $dept_id, $dept_role]);
    }

    json_ok(['id' => $id, 'username' => $username, 'display_name' => $display_name, 'role' => $role], 201);
}

function handle_update(): void {
    require_method('PUT');
    require_permission('manage_users');
    verify_csrf();

    $b            = body();
    $id           = (int)($b['id'] ?? $_GET['id'] ?? 0);
    $display_name = trim($b['display_name'] ?? '');
    $role         = $b['role'] ?? null;
    $is_active    = $b['is_active'] ?? null;

    if (!$id) json_error('id required');

    $sets   = [];
    $params = [];

    if ($display_name !== '') { $sets[] = 'display_name = ?'; $params[] = $display_name; }
    if ($role !== null) {
        $valid_roles = ['production_admin', 'production_staff', 'dept_admin', 'dept_staff'];
        if (!in_array($role, $valid_roles, true)) json_error('Invalid role');
        $sets[] = 'role = ?'; $params[] = $role;
    }
    if ($is_active !== null) {
        $sets[] = 'is_active = ?'; $params[] = $is_active ? 1 : 0;
    }

    if (!empty($sets)) {
        $params[] = $id;
        $stmt = db()->prepare('UPDATE users SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
        if ($stmt->rowCount() === 0) json_error('User not found', 404);
    }

    // Update dept memberships if provided
    if (isset($b['dept_memberships'])) {
        db()->prepare('DELETE FROM user_dept_roles WHERE user_id = ?')->execute([$id]);
        foreach ($b['dept_memberships'] as $m) {
            $dept_id   = (int)($m['dept_id'] ?? 0);
            $dept_role = $m['role'] ?? 'dept_staff';
            if (!$dept_id || !in_array($dept_role, ['dept_admin', 'dept_staff'], true)) continue;
            db()->prepare(
                'INSERT IGNORE INTO user_dept_roles (user_id, dept_id, role) VALUES (?, ?, ?)'
            )->execute([$id, $dept_id, $dept_role]);
        }
    }

    json_ok(['success' => true]);
}

function handle_reset_password(): void {
    require_method('POST');
    require_permission('manage_users');
    verify_csrf();

    $b        = body();
    $id       = (int)($b['id'] ?? $_GET['id'] ?? 0);
    $password = $b['new_password'] ?? '';

    if (!$id) json_error('id required');
    if (strlen($password) < 8) json_error('Password must be at least 8 characters');

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $stmt = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
    $stmt->execute([$hash, $id]);

    if ($stmt->rowCount() === 0) json_error('User not found', 404);
    json_ok(['success' => true]);
}

function handle_delete(): void {
    require_method('DELETE');
    require_permission('manage_users');
    verify_csrf();

    $b  = body();
    $id = (int)($b['id'] ?? $_GET['id'] ?? 0);
    if (!$id) json_error('id required');

    start_session();
    if ($id === (int)($_SESSION['user_id'] ?? 0)) {
        json_error('Cannot delete your own account', 409);
    }

    // Soft deactivate to preserve transaction history
    $stmt = db()->prepare('UPDATE users SET is_active = 0 WHERE id = ?');
    $stmt->execute([$id]);
    if ($stmt->rowCount() === 0) json_error('User not found', 404);

    json_ok(['success' => true]);
}


function handle_user_qr_sheet(): void {
    require_method('GET');
    require_permission('manage_users');

    $users = db()->query(
        'SELECT id, display_name, qr_token FROM users WHERE is_active = 1 ORDER BY display_name'
    )->fetchAll();

    // Generate QR tokens for any users that don't have one
    foreach ($users as &$u) {
        if (empty($u['qr_token'])) {
            $u['qr_token'] = ensure_user_qr_token((int)$u['id']);
        }
    }
    unset($u);

    if (empty($users)) {
        header('Content-Type: text/html; charset=utf-8');
        echo '<p style="font-family:sans-serif;padding:2rem">No active users found.</p>';
        exit;
    }

    $use_lib = file_exists(__DIR__ . '/../../../../vendor/phpqrcode/qrlib.php');
    if ($use_lib) {
        require_once __DIR__ . '/../../../../vendor/phpqrcode/qrlib.php';
    }

    $scheme   = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $base_url = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $count    = count($users);
    $cards    = '';

    foreach ($users as $u) {
        $url      = $base_url . '/?person=' . rawurlencode($u['qr_token']);
        $name_esc = htmlspecialchars($u['display_name'], ENT_QUOTES, 'UTF-8');

        if ($use_lib) {
            ob_start();
            QRcode::png($url, false, QR_ECLEVEL_M, 6, 2);
            $png = ob_get_clean();
            $src = 'data:image/png;base64,' . base64_encode($png);
        } else {
            $src = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' . urlencode($url);
        }

        $cards .= '<div class="card">'
            . '<img src="' . $src . '" alt="Person QR" width="160" height="160">'
            . '<div class="person-name">' . $name_esc . '</div>'
            . '</div>' . "\n";
    }

    header('Content-Type: text/html; charset=utf-8');
    echo '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<title>Staff QR Codes</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:Arial,sans-serif; background:#fff; }
.toolbar { display:flex;gap:1rem;padding:1rem;background:#f5f5f5;border-bottom:1px solid #ddd;align-items:center; }
.toolbar button { padding:.5rem 1.25rem;border:1px solid #999;border-radius:4px;background:#fff;cursor:pointer; }
.toolbar button:hover { background:#e8e8e8; }
.toolbar span { color:#666;font-size:.85rem; }
.grid { display:grid;grid-template-columns:repeat(4,1fr);padding:1cm;gap:.5cm; }
.card { display:flex;flex-direction:column;align-items:center;padding:.5cm;border:1px solid #eee;page-break-inside:avoid;break-inside:avoid; }
.card img { width:2.5cm;height:2.5cm;display:block; }
.person-name { margin-top:.3cm;font-size:10pt;font-weight:bold;text-align:center; }
@media print { .toolbar { display:none; } .grid { padding:.5cm; } }
</style></head><body>
<div class="toolbar">
<button onclick="window.print()">Print / Save as PDF</button>
<button onclick="window.close()">Close</button>
<span>' . $count . ' staff QR code' . ($count !== 1 ? 's' : '') . '</span>
</div>
<div class="grid">' . $cards . '</div></body></html>';
    exit;
}
