<?php
declare(strict_types=1);

function handle_list_invites(): void {
    require_method('GET');
    $user = require_permission('create_invites');

    $where  = '';
    $params = [];

    // dept_admin: only see their own invites
    if (!has_permission('manage_departments')) {
        $placeholders = implode(',', array_fill(0, count($user['dept_ids']), '?'));
        $where        = $placeholders ? "WHERE it.dept_id IN ($placeholders)" : 'WHERE 1=0';
        $params       = $user['dept_ids'];
    }

    $stmt = db()->prepare(
        "SELECT it.id, it.token, it.role, it.dept_id, it.use_count, it.expires_at, it.created_at,
                d.name AS dept_name,
                u.display_name AS created_by_name
         FROM invite_tokens it
         LEFT JOIN departments d ON d.id = it.dept_id
         LEFT JOIN users u ON u.id = it.created_by
         $where
         ORDER BY it.created_at DESC"
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $scheme   = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $base_url = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');

    foreach ($rows as &$r) {
        $r['id']        = (int)$r['id'];
        $r['use_count'] = (int)$r['use_count'];
        $r['used']      = $r['use_count'] >= 1;
        $r['expired']   = strtotime($r['expires_at']) < time();
        $r['url']       = $base_url . '/register.html?token=' . $r['token'];
    }
    unset($r);

    json_ok(['invites' => $rows]);
}

function handle_create_invite(): void {
    require_method('POST');
    $user = require_permission('create_invites');
    verify_csrf();

    $b         = body();
    $role      = trim($b['role'] ?? '');
    $dept_id   = isset($b['dept_id']) ? (int)$b['dept_id'] : null;
    $ttl_hours = max(1, min(168, (int)($b['ttl_hours'] ?? 72)));

    $valid_roles = ['production_admin', 'production_staff', 'dept_admin', 'dept_staff'];
    if (!in_array($role, $valid_roles, true)) {
        json_error('Invalid role');
    }

    // dept_admin can only create dept_staff tokens for their own depts
    if (!has_permission('manage_departments')) {
        if ($role !== 'dept_staff') {
            json_error('You can only create dept_staff invites', 403);
        }
        if (!$dept_id || !in_array($dept_id, $user['dept_ids'], true)) {
            json_error('Forbidden', 403);
        }
    }

    // dept-level roles require a dept
    if (in_array($role, ['dept_admin', 'dept_staff'], true) && !$dept_id) {
        json_error('dept_id required for dept roles');
    }

    $token   = bin2hex(random_bytes(32));
    $expires = date('Y-m-d H:i:s', time() + $ttl_hours * 3600);

    db()->prepare(
        'INSERT INTO invite_tokens (token, role, dept_id, created_by, expires_at)
         VALUES (?, ?, ?, ?, ?)'
    )->execute([$token, $role, $dept_id ?: null, $user['id'], $expires]);

    $id = (int)db()->lastInsertId();

    $scheme   = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $base_url = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');

    json_ok([
        'id'         => $id,
        'token'      => $token,
        'url'        => $base_url . '/register.html?token=' . $token,
        'expires_at' => $expires,
    ], 201);
}

function handle_revoke_invite(): void {
    require_method('DELETE');
    $user = require_permission('create_invites');
    verify_csrf();

    $b  = body();
    $id = (int)($b['id'] ?? 0);
    if (!$id) json_error('id required');

    // dept_admin: verify they own this invite
    if (!has_permission('manage_departments')) {
        $tok_stmt = db()->prepare('SELECT dept_id FROM invite_tokens WHERE id = ?');
        $tok_stmt->execute([$id]);
        $tok = $tok_stmt->fetch();
        if (!$tok || !in_array((int)$tok['dept_id'], $user['dept_ids'], true)) {
            json_error('Forbidden', 403);
        }
    }

    // Revoke by setting expires_at to now
    db()->prepare("UPDATE invite_tokens SET expires_at = NOW() WHERE id = ?")->execute([$id]);
    json_ok(['success' => true]);
}
