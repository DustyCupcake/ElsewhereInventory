<?php
declare(strict_types=1);

function handle_list_artists_admin(): void {
    require_method('GET');
    $user = require_permission('manage_artists');

    $where  = '';
    $params = [];

    if (!has_permission('manage_departments')) {
        $placeholders = implode(',', array_fill(0, count($user['dept_ids']), '?'));
        $where        = $placeholders ? "WHERE a.dept_id IN ($placeholders)" : 'WHERE 1=0';
        $params       = $user['dept_ids'];
    } elseif (isset($_GET['dept_id'])) {
        $where  = 'WHERE a.dept_id = ?';
        $params = [(int)$_GET['dept_id']];
    }

    $stmt = db()->prepare(
        "SELECT a.id, a.dept_id, d.name AS dept_name, a.name, a.sort_order,
                a.assigned_staff_id, u.display_name AS assigned_staff_name, a.created_at
         FROM artists a
         JOIN departments d ON d.id = a.dept_id
         LEFT JOIN users u ON u.id = a.assigned_staff_id
         $where
         ORDER BY a.sort_order, a.name"
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$r) {
        $r['id']      = (int)$r['id'];
        $r['dept_id'] = (int)$r['dept_id'];
        if ($r['assigned_staff_id']) $r['assigned_staff_id'] = (int)$r['assigned_staff_id'];
    }
    unset($r);

    json_ok(['artists' => $rows]);
}

function handle_create_artist(): void {
    require_method('POST');
    $user = require_permission('manage_artists');
    verify_csrf();

    $b                 = body();
    $dept_id           = (int)($b['dept_id'] ?? 0);
    $name              = trim($b['name'] ?? '');
    $sort_order        = (int)($b['sort_order'] ?? 0);
    $assigned_staff_id = isset($b['assigned_staff_id']) ? (int)$b['assigned_staff_id'] : null;

    if (!$dept_id || $name === '') json_error('dept_id and name required');

    // Verify this dept uses artists
    $dept_stmt = db()->prepare('SELECT sub_entity FROM departments WHERE id = ?');
    $dept_stmt->execute([$dept_id]);
    $dept = $dept_stmt->fetch();
    if (!$dept || $dept['sub_entity'] !== 'artist') {
        json_error('Department does not use artists');
    }

    // dept_admin access check
    if (!has_permission('manage_departments') && !in_array($dept_id, $user['dept_ids'], true)) {
        json_error('Forbidden', 403);
    }

    // Resolve assigned_staff by username if string provided
    if (isset($b['assigned_staff_username']) && !$assigned_staff_id) {
        $u_stmt = db()->prepare(
            'SELECT u.id FROM users u
             JOIN user_dept_roles udr ON udr.user_id = u.id
             WHERE u.username = ? AND udr.dept_id = ?'
        );
        $u_stmt->execute([trim($b['assigned_staff_username']), $dept_id]);
        $u = $u_stmt->fetch();
        if ($u) $assigned_staff_id = (int)$u['id'];
    }

    try {
        db()->prepare(
            'INSERT INTO artists (dept_id, name, sort_order, assigned_staff_id) VALUES (?, ?, ?, ?)'
        )->execute([$dept_id, $name, $sort_order, $assigned_staff_id]);
        $id = (int)db()->lastInsertId();
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) json_error('Artist name already exists in this department', 409);
        throw $e;
    }

    json_ok(['id' => $id], 201);
}

function handle_update_artist(): void {
    require_method('PUT');
    $user = require_permission('manage_artists');
    verify_csrf();

    $b  = body();
    $id = (int)($b['id'] ?? 0);
    if (!$id) json_error('id required');

    $artist_stmt = db()->prepare('SELECT dept_id FROM artists WHERE id = ?');
    $artist_stmt->execute([$id]);
    $artist = $artist_stmt->fetch();
    if (!$artist) json_error('Artist not found', 404);

    if (!has_permission('manage_departments') && !in_array((int)$artist['dept_id'], $user['dept_ids'], true)) {
        json_error('Forbidden', 403);
    }

    $sets   = [];
    $params = [];

    if (isset($b['name']) && trim($b['name']) !== '') {
        $sets[] = 'name = ?'; $params[] = trim($b['name']);
    }
    if (isset($b['sort_order'])) {
        $sets[] = 'sort_order = ?'; $params[] = (int)$b['sort_order'];
    }
    if (array_key_exists('assigned_staff_id', $b)) {
        $sets[] = 'assigned_staff_id = ?';
        $params[] = $b['assigned_staff_id'] ? (int)$b['assigned_staff_id'] : null;
    }

    if (empty($sets)) json_error('Nothing to update');

    $params[] = $id;
    db()->prepare('UPDATE artists SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($params);
    json_ok(['success' => true]);
}

function handle_delete_artist(): void {
    require_method('DELETE');
    $user = require_permission('manage_artists');
    verify_csrf();

    $b  = body();
    $id = (int)($b['id'] ?? 0);
    if (!$id) json_error('id required');

    $count_stmt = db()->prepare('SELECT COUNT(*) FROM equipment_items WHERE current_artist_id = ?');
    $count_stmt->execute([$id]);
    if ((int)$count_stmt->fetchColumn() > 0) {
        json_error('Cannot delete artist with checked-out equipment', 409);
    }

    db()->prepare('DELETE FROM artists WHERE id = ?')->execute([$id]);
    json_ok(['success' => true]);
}

function handle_import_artists_csv(): void {
    require_method('POST');
    $user = require_permission('manage_artists');
    verify_csrf();

    $dept_id = (int)($_GET['dept_id'] ?? 0);
    if (!$dept_id) json_error('dept_id required');

    if (!has_permission('manage_departments') && !in_array($dept_id, $user['dept_ids'], true)) {
        json_error('Forbidden', 403);
    }

    if (empty($_FILES['file'])) json_error('file required', 400);

    $path = $_FILES['file']['tmp_name'];
    $fh   = fopen($path, 'r');
    if (!$fh) json_error('Could not read file');

    $header  = array_map('strtolower', array_map('trim', fgetcsv($fh)));
    $name_i  = array_search('name', $header);
    $order_i = array_search('sort_order', $header);
    $staff_i = array_search('assigned_staff', $header);

    if ($name_i === false) {
        fclose($fh);
        json_error('CSV must have a "name" column');
    }

    $created = $updated = $skipped = 0;

    while (($row = fgetcsv($fh)) !== false) {
        $name = trim($row[$name_i] ?? '');
        if ($name === '') { $skipped++; continue; }

        $sort_order = $order_i !== false ? (int)($row[$order_i] ?? 0) : 0;

        $assigned_staff_id = null;
        if ($staff_i !== false && trim($row[$staff_i] ?? '') !== '') {
            $u_stmt = db()->prepare(
                'SELECT u.id FROM users u JOIN user_dept_roles udr ON udr.user_id = u.id
                 WHERE u.username = ? AND udr.dept_id = ?'
            );
            $u_stmt->execute([trim($row[$staff_i]), $dept_id]);
            $u = $u_stmt->fetch();
            if ($u) $assigned_staff_id = (int)$u['id'];
        }

        $exists_stmt = db()->prepare('SELECT id FROM artists WHERE dept_id = ? AND name = ?');
        $exists_stmt->execute([$dept_id, $name]);
        $exists = $exists_stmt->fetch();

        if ($exists) {
            db()->prepare(
                'UPDATE artists SET sort_order = ?, assigned_staff_id = ? WHERE id = ?'
            )->execute([$sort_order, $assigned_staff_id, $exists['id']]);
            $updated++;
        } else {
            db()->prepare(
                'INSERT INTO artists (dept_id, name, sort_order, assigned_staff_id) VALUES (?, ?, ?, ?)'
            )->execute([$dept_id, $name, $sort_order, $assigned_staff_id]);
            $created++;
        }
    }
    fclose($fh);

    json_ok(['created' => $created, 'updated' => $updated, 'skipped' => $skipped]);
}
