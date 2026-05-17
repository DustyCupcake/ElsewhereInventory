<?php
declare(strict_types=1);

function handle_list_artists(): void {
    require_method('GET');
    $user = require_auth();

    $where  = '';
    $params = [];

    if (has_permission('view_inventory')) {
        // production level: can filter by dept or see all
        if (isset($_GET['dept_id'])) {
            $where  = 'WHERE a.dept_id = ?';
            $params = [(int)$_GET['dept_id']];
        }
    } else {
        // dept level: scope to own depts with view_artists perm
        if (!has_permission('view_artists')) {
            json_error('Forbidden', 403);
        }
        $placeholders = implode(',', array_fill(0, count($user['dept_ids']), '?'));
        $where        = $placeholders ? "WHERE a.dept_id IN ($placeholders)" : 'WHERE 1=0';
        $params       = $user['dept_ids'];
    }

    $stmt = db()->prepare(
        "SELECT a.id, a.dept_id, d.name AS dept_name, a.name, a.sort_order,
                u.display_name AS assigned_staff_name,
                COUNT(ei.id) AS items_out
         FROM artists a
         JOIN departments d ON d.id = a.dept_id
         LEFT JOIN users u ON u.id = a.assigned_staff_id
         LEFT JOIN equipment_items ei ON ei.current_artist_id = a.id
         $where
         GROUP BY a.id
         ORDER BY a.sort_order, a.name"
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$r) {
        $r['id']       = (int)$r['id'];
        $r['dept_id']  = (int)$r['dept_id'];
        $r['items_out'] = (int)$r['items_out'];
    }
    unset($r);

    json_ok(['artists' => $rows]);
}

function handle_get_artist(): void {
    require_method('GET');
    $user      = require_auth();
    $artist_id = (int)($_GET['id'] ?? 0);
    if (!$artist_id) json_error('id required');

    $stmt = db()->prepare(
        'SELECT a.*, d.name AS dept_name, u.display_name AS assigned_staff_name
         FROM artists a
         JOIN departments d ON d.id = a.dept_id
         LEFT JOIN users u ON u.id = a.assigned_staff_id
         WHERE a.id = ?'
    );
    $stmt->execute([$artist_id]);
    $artist = $stmt->fetch();

    if (!$artist) json_error('Artist not found', 404);

    // Access check
    if (!has_permission('view_inventory')) {
        require_dept_access((int)$artist['dept_id']);
    }

    $artist['id']      = (int)$artist['id'];
    $artist['dept_id'] = (int)$artist['dept_id'];

    // Currently checked-out items
    $stmt = db()->prepare(
        'SELECT ei.id, ei.qr_code, ei.dept_label, et.name AS type_name, ei.item_number
         FROM equipment_items ei
         JOIN equipment_types et ON et.id = ei.equipment_type_id
         WHERE ei.current_artist_id = ?
         ORDER BY et.name, ei.item_number'
    );
    $stmt->execute([$artist_id]);
    $items = $stmt->fetchAll();

    foreach ($items as &$i) $i['id'] = (int)$i['id'];
    unset($i);

    json_ok(array_merge($artist, ['current_items' => $items]));
}
