<?php
declare(strict_types=1);

function handle_lookup(): void {
    require_method('GET');
    require_auth();

    $qr = trim($_GET['qr'] ?? '');
    if ($qr === '') json_error('qr parameter required');

    $stmt = db()->prepare(
        'SELECT i.id, i.qr_code, i.status, i.notes, i.equipment_type_id,
                i.dept_label, i.current_dept_id, i.current_barrio_id, i.current_artist_id, i.current_person_id,
                i.current_location_id,
                i.home_location_id AS item_home_loc_id,
                i.require_home_location AS item_require_home,
                i.require_any_location AS item_require_any,
                t.name AS type_name, t.category, t.secure_qr, t.borrowable,
                t.home_location_id AS type_home_loc_id,
                t.require_home_location AS type_require_home,
                t.require_any_location AS type_require_any,
                b.id AS barrio_id, b.name AS barrio_name,
                d.id AS dept_id, d.name AS dept_name,
                a.id AS artist_id, a.name AS artist_name,
                p.id AS person_id, p.display_name AS person_name,
                cl.name AS current_location_name,
                hl.id AS eff_home_loc_id, hl.name AS home_location_name,
                CONCAT(t.name, " #", i.item_number) AS display_name
         FROM equipment_items i
         JOIN equipment_types t ON t.id = i.equipment_type_id
         LEFT JOIN barrios b ON b.id = i.current_barrio_id
         LEFT JOIN departments d ON d.id = i.current_dept_id
         LEFT JOIN artists a ON a.id = i.current_artist_id
         LEFT JOIN users p ON p.id = i.current_person_id
         LEFT JOIN storage_locations cl ON cl.id = i.current_location_id
         LEFT JOIN storage_locations hl ON hl.id = COALESCE(i.home_location_id, t.home_location_id)
         WHERE i.qr_code = ?'
    );
    $stmt->execute([$qr]);
    $item = $stmt->fetch();

    if (!$item) json_error('Item not found', 404);

    $borrowable = (bool)($item['borrowable'] ?? false);
    $eligibility = $borrowable
        ? check_borrow_eligible((int)$item['id'], (int)$item['equipment_type_id'])
        : ['eligible' => false, 'reason' => 'not_borrowable'];

    // Resolve effective location requirements
    $eff_require_home = $item['item_require_home'] !== null
        ? (bool)$item['item_require_home']
        : (bool)$item['type_require_home'];
    $eff_require_any  = $item['item_require_any'] !== null
        ? (bool)$item['item_require_any']
        : (bool)$item['type_require_any'];

    json_ok([
        'id'                   => (int)$item['id'],
        'qr_code'              => $item['qr_code'],
        'name'                 => $item['display_name'],
        'category'             => $item['category'],
        'status'               => $item['status'],
        'secure_qr'            => (bool)$item['secure_qr'],
        'equipment_type_id'    => (int)$item['equipment_type_id'],
        'dept_label'           => $item['dept_label'],
        'current_dept'         => $item['dept_id']
            ? ['id' => (int)$item['dept_id'], 'name' => $item['dept_name']]
            : null,
        'current_barrio'       => $item['barrio_id']
            ? ['id' => (int)$item['barrio_id'], 'name' => $item['barrio_name']]
            : null,
        'current_artist'       => $item['artist_id']
            ? ['id' => (int)$item['artist_id'], 'name' => $item['artist_name']]
            : null,
        'current_person'       => $item['person_id']
            ? ['id' => (int)$item['person_id'], 'name' => $item['person_name']]
            : null,
        'current_location'     => $item['current_location_id']
            ? ['id' => (int)$item['current_location_id'], 'name' => $item['current_location_name']]
            : null,
        'home_location'        => $item['eff_home_loc_id']
            ? ['id' => (int)$item['eff_home_loc_id'], 'name' => $item['home_location_name']]
            : null,
        'require_home_location' => $eff_require_home,
        'require_any_location'  => $eff_require_any,
        'borrowable'           => $borrowable,
        'borrow_eligible'      => $eligibility['eligible'],
        'borrow_reason'        => $eligibility['reason'],
    ]);
}

function handle_inventory(): void {
    require_method('GET');
    require_auth();

    $status_filter = $_GET['status'] ?? null;
    $where = '';
    $params = [];
    if (in_array($status_filter, ['available', 'checked-out', 'retired'], true)) {
        $where = 'WHERE i.status = ?';
        $params[] = $status_filter;
    } else {
        $where = "WHERE i.status != 'retired'";
    }

    $rows = db()->prepare(
        "SELECT i.id, i.qr_code, i.status, i.dept_label,
                CONCAT(t.name, ' #', i.item_number) AS name,
                t.category,
                d.name AS current_dept,
                b.name AS current_barrio,
                a.name AS current_artist
         FROM equipment_items i
         JOIN equipment_types t ON t.id = i.equipment_type_id
         LEFT JOIN departments d ON d.id = i.current_dept_id
         LEFT JOIN barrios b ON b.id = i.current_barrio_id
         LEFT JOIN artists a ON a.id = i.current_artist_id
         $where
         ORDER BY t.name, i.item_number"
    );
    $rows->execute($params);
    $items = $rows->fetchAll();

    $available   = 0;
    $checked_out = 0;
    foreach ($items as $it) {
        if ($it['status'] === 'available')    $available++;
        if ($it['status'] === 'checked-out')  $checked_out++;
    }

    // Cast ids
    foreach ($items as &$it) {
        $it['id'] = (int)$it['id'];
    }
    unset($it);

    json_ok([
        'stats' => ['available' => $available, 'checked_out' => $checked_out],
        'items' => $items,
    ]);
}
