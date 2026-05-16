<?php
declare(strict_types=1);

function handle_list_departments(): void {
    require_method('GET');
    require_auth();

    $rows = db()->query(
        'SELECT id, name, slug, sub_entity, sort_order
         FROM departments
         WHERE is_active = 1
         ORDER BY sort_order, name'
    )->fetchAll();

    foreach ($rows as &$r) {
        $r['id']         = (int)$r['id'];
        $r['sort_order'] = (int)$r['sort_order'];
    }
    unset($r);

    json_ok(['departments' => $rows]);
}

function handle_get_department(): void {
    require_method('GET');
    $user    = require_auth();
    $dept_id = (int)($_GET['id'] ?? 0);
    if (!$dept_id) json_error('id required');

    require_dept_access($dept_id);

    $dept = db()->prepare(
        'SELECT d.id, d.name, d.slug, d.sub_entity, d.sort_order
         FROM departments d WHERE d.id = ? AND d.is_active = 1'
    )->execute([$dept_id])->fetch();

    if (!$dept) json_error('Department not found', 404);

    $dept['id']         = (int)$dept['id'];
    $dept['sort_order'] = (int)$dept['sort_order'];

    // Sub-entities
    $sub_entities = [];
    if ($dept['sub_entity'] === 'barrio') {
        $sub_entities = db()->prepare(
            'SELECT id, name, arrival_status FROM barrios WHERE dept_id = ? ORDER BY sort_order, name'
        )->execute([$dept_id])->fetchAll();
    } elseif ($dept['sub_entity'] === 'artist') {
        $sub_entities = db()->prepare(
            'SELECT a.id, a.name, u.display_name AS assigned_staff_name
             FROM artists a
             LEFT JOIN users u ON u.id = a.assigned_staff_id
             WHERE a.dept_id = ? ORDER BY a.sort_order, a.name'
        )->execute([$dept_id])->fetchAll();
    }

    foreach ($sub_entities as &$s) $s['id'] = (int)$s['id'];
    unset($s);

    // Pool size: items in dept but not sub-lent
    $pool_size = (int)db()->prepare(
        'SELECT COUNT(*) FROM equipment_items
         WHERE current_dept_id = ? AND current_barrio_id IS NULL AND current_artist_id IS NULL'
    )->execute([$dept_id])->fetchColumn();

    // Order totals
    $orders = db()->prepare(
        'SELECT deo.equipment_type_id, et.name AS type_name, deo.quantity_ordered, deo.submitted_at
         FROM dept_equipment_orders deo
         JOIN equipment_types et ON et.id = deo.equipment_type_id
         WHERE deo.dept_id = ?
         ORDER BY et.name'
    )->execute([$dept_id])->fetchAll();

    json_ok(array_merge($dept, [
        'sub_entities' => $sub_entities,
        'pool_size'    => $pool_size,
        'orders'       => $orders,
    ]));
}
