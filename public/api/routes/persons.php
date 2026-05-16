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
