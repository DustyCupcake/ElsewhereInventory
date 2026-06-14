<?php
declare(strict_types=1);

// ─── Equipment Types ───────────────────────────────────────────────────────

function handle_list_types(): void {
    require_method('GET');
    require_admin();

    $rows = db()->query(
        'SELECT t.id, t.name, t.category, t.secure_qr, t.borrowable,
                t.home_location_id, t.require_home_location, t.require_any_location,
                sl.name AS home_location_name,
                t.created_at,
                COUNT(i.id) AS item_count
         FROM equipment_types t
         LEFT JOIN equipment_items i ON i.equipment_type_id = t.id AND i.status != "retired"
         LEFT JOIN storage_locations sl ON sl.id = t.home_location_id
         GROUP BY t.id
         ORDER BY t.name'
    )->fetchAll();
    foreach ($rows as &$r) {
        $r['id']                    = (int)$r['id'];
        $r['item_count']            = (int)$r['item_count'];
        $r['secure_qr']             = (bool)$r['secure_qr'];
        $r['borrowable']            = (bool)$r['borrowable'];
        $r['require_home_location'] = (bool)$r['require_home_location'];
        $r['require_any_location']  = (bool)$r['require_any_location'];
        $r['home_location_id']      = $r['home_location_id'] ? (int)$r['home_location_id'] : null;
    }
    unset($r);
    json_ok(['types' => $rows]);
}

function handle_create_type(): void {
    require_method('POST');
    require_admin();
    verify_csrf();

    $b                    = body();
    $name                 = trim($b['name'] ?? '');
    $category             = trim($b['category'] ?? '');
    $secure_qr            = !empty($b['secure_qr']) ? 1 : 0;
    $borrowable           = !empty($b['borrowable']) ? 1 : 0;
    $home_location_id     = isset($b['home_location_id']) && $b['home_location_id'] !== '' ? (int)$b['home_location_id'] : null;
    $require_home_location = !empty($b['require_home_location']) ? 1 : 0;
    $require_any_location  = !empty($b['require_any_location']) ? 1 : 0;

    if ($name === '') json_error('name required');

    try {
        $stmt = db()->prepare(
            'INSERT INTO equipment_types (name, category, secure_qr, borrowable, home_location_id, require_home_location, require_any_location)
             VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([$name, $category ?: null, $secure_qr, $borrowable, $home_location_id, $require_home_location, $require_any_location]);
        $id = (int)db()->lastInsertId();
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) json_error('Name already exists', 409);
        throw $e;
    }

    json_ok(['id' => $id, 'name' => $name, 'category' => $category ?: null, 'secure_qr' => (bool)$secure_qr], 201);
}

function handle_update_type(): void {
    require_method('PUT');
    require_admin();
    verify_csrf();

    $b                    = body();
    $id                   = (int)($b['id'] ?? $_GET['id'] ?? 0);
    $name                 = trim($b['name'] ?? '');
    $category             = trim($b['category'] ?? '');
    $secure_qr            = isset($b['secure_qr']) ? (!empty($b['secure_qr']) ? 1 : 0) : null;
    $borrowable           = isset($b['borrowable']) ? (!empty($b['borrowable']) ? 1 : 0) : null;
    $home_location_id     = array_key_exists('home_location_id', $b)
        ? ($b['home_location_id'] !== '' && $b['home_location_id'] !== null ? (int)$b['home_location_id'] : null)
        : false; // false = not provided
    $require_home_location = isset($b['require_home_location']) ? (!empty($b['require_home_location']) ? 1 : 0) : null;
    $require_any_location  = isset($b['require_any_location'])  ? (!empty($b['require_any_location'])  ? 1 : 0) : null;

    if (!$id || $name === '') json_error('id and name required');

    $sets   = ['name = ?', 'category = ?'];
    $params = [$name, $category ?: null];

    if ($secure_qr !== null)            { $sets[] = 'secure_qr = ?';            $params[] = $secure_qr; }
    if ($borrowable !== null)           { $sets[] = 'borrowable = ?';           $params[] = $borrowable; }
    if ($home_location_id !== false)    { $sets[] = 'home_location_id = ?';     $params[] = $home_location_id; }
    if ($require_home_location !== null){ $sets[] = 'require_home_location = ?';$params[] = $require_home_location; }
    if ($require_any_location !== null) { $sets[] = 'require_any_location = ?'; $params[] = $require_any_location; }

    $params[] = $id;

    try {
        $stmt = db()->prepare('UPDATE equipment_types SET ' . implode(', ', $sets) . ' WHERE id = ?');
        $stmt->execute($params);
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) json_error('Name already exists', 409);
        throw $e;
    }

    if ($stmt->rowCount() === 0) json_error('Type not found', 404);
    json_ok(['success' => true]);
}

function handle_delete_type(): void {
    require_method('DELETE');
    require_admin();
    verify_csrf();

    $b  = body();
    $id = (int)($b['id'] ?? $_GET['id'] ?? 0);
    if (!$id) json_error('id required');

    $count = db()->prepare('SELECT COUNT(*) FROM equipment_items WHERE equipment_type_id = ? AND status != "retired"');
    $count->execute([$id]);
    if ((int)$count->fetchColumn() > 0) {
        json_error('Cannot delete — active items exist for this type', 409);
    }

    db()->prepare('DELETE FROM equipment_types WHERE id = ?')->execute([$id]);
    json_ok(['success' => true]);
}

// ─── Equipment Items ───────────────────────────────────────────────────────

function handle_list_items(): void {
    require_method('GET');
    require_admin();

    $type_id = (int)($_GET['type_id'] ?? 0);
    $status  = $_GET['status'] ?? null;
    $where   = [];
    $params  = [];

    if ($type_id) { $where[] = 'i.equipment_type_id = ?'; $params[] = $type_id; }
    if (in_array($status, ['available', 'checked-out', 'retired'], true)) {
        $where[] = 'i.status = ?';
        $params[] = $status;
    }

    $whereSQL = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    $stmt = db()->prepare(
        "SELECT i.id, i.qr_code, i.item_number, i.status, i.notes, i.route_position,
                i.latitude, i.longitude, i.created_at,
                i.home_location_id, i.require_home_location, i.require_any_location,
                t.id AS type_id, t.name AS type_name, t.category,
                CONCAT(t.name, ' #', i.item_number) AS display_name,
                b.name AS current_barrio,
                hl.name AS home_location_name
         FROM equipment_items i
         JOIN equipment_types t ON t.id = i.equipment_type_id
         LEFT JOIN barrios b    ON b.id = i.current_barrio_id
         LEFT JOIN storage_locations hl ON hl.id = i.home_location_id
         $whereSQL
         ORDER BY t.name, i.item_number"
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']             = (int)$r['id'];
        $r['item_number']    = (int)$r['item_number'];
        $r['type_id']        = (int)$r['type_id'];
        $r['home_location_id'] = $r['home_location_id'] ? (int)$r['home_location_id'] : null;
        $r['require_home_location'] = $r['require_home_location'] !== null ? (bool)$r['require_home_location'] : null;
        $r['require_any_location']  = $r['require_any_location']  !== null ? (bool)$r['require_any_location']  : null;
        $r['latitude']  = $r['latitude']  !== null ? (float)$r['latitude']  : null;
        $r['longitude'] = $r['longitude'] !== null ? (float)$r['longitude'] : null;
    }
    unset($r);
    json_ok(['items' => $rows]);
}

function handle_create_items(): void {
    require_method('POST');
    require_admin();
    verify_csrf();

    $b         = body();
    $type_id   = (int)($b['equipment_type_id'] ?? 0);
    $count     = max(1, (int)($b['count'] ?? 1));
    $qr_prefix = strtoupper(trim($b['qr_prefix'] ?? ''));

    if (!$type_id) json_error('equipment_type_id required');
    if ($count > 100) json_error('Max 100 items at a time');

    // Verify type exists
    $type_stmt = db()->prepare('SELECT name, secure_qr FROM equipment_types WHERE id = ?');
    $type_stmt->execute([$type_id]);
    $type = $type_stmt->fetch();
    if (!$type) json_error('Equipment type not found', 404);

    $is_secure = (bool)$type['secure_qr'];
    $auto_prefix = strtoupper(preg_replace('/[^A-Z0-9]/i', '', $type['name']));

    if (!$is_secure) {
        // Sequential numbering
        $max_stmt = db()->prepare('SELECT COALESCE(MAX(item_number), 0) FROM equipment_items WHERE equipment_type_id = ?');
        $max_stmt->execute([$type_id]);
        $start = (int)$max_stmt->fetchColumn() + 1;
    }

    $created = [];
    $pdo     = db();
    $pdo->beginTransaction();
    try {
        for ($i = 0; $i < $count; $i++) {
            if ($is_secure) {
                // Random 5-digit number, retry on collision
                $attempts = 0;
                do {
                    $num = random_int(10000, 99999);
                    $chk = $pdo->prepare('SELECT id FROM equipment_items WHERE equipment_type_id = ? AND item_number = ?');
                    $chk->execute([$type_id, $num]);
                    $attempts++;
                    if ($attempts > 50) json_error('Could not generate unique item number after 50 attempts', 500);
                } while ($chk->fetch());
                $qr = $qr_prefix ? sprintf('%s-%05d', $qr_prefix, $num) : sprintf('%s-%05d', $auto_prefix, $num);
            } else {
                $num = $start + $i;
                $qr  = $qr_prefix ? sprintf('%s-%03d', $qr_prefix, $num) : sprintf('%s-%03d', $auto_prefix, $num);
            }

            $ins = $pdo->prepare(
                'INSERT INTO equipment_items (equipment_type_id, item_number, qr_code) VALUES (?, ?, ?)'
            );
            $ins->execute([$type_id, $num, $qr]);
            $created[] = [
                'id'          => (int)$pdo->lastInsertId(),
                'item_number' => $num,
                'qr_code'     => $qr,
                'display_name'=> $type['name'] . ' #' . $num,
            ];
        }
        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate')) json_error('QR code collision — try a different prefix', 409);
        throw $e;
    }

    json_ok(['created' => $created], 201);
}

function handle_update_item(): void {
    require_method('PUT');
    require_permission('manage_equipment');
    verify_csrf();

    $b              = body();
    $id             = (int)($b['id'] ?? $_GET['id'] ?? 0);
    $status         = $b['status'] ?? null;
    $notes          = $b['notes']  ?? null;
    $route_position = array_key_exists('route_position', $b)
        ? ($b['route_position'] === null || $b['route_position'] === '' ? null : (int)$b['route_position'])
        : 'unset';

    // home_location_id: false = not provided, null = clear, int = set
    $home_location_id = array_key_exists('home_location_id', $b)
        ? ($b['home_location_id'] !== null && $b['home_location_id'] !== '' ? (int)$b['home_location_id'] : null)
        : false;

    // require flags: 'unset' = not provided, null = inherit from type, bool = override
    $require_home = array_key_exists('require_home_location', $b)
        ? ($b['require_home_location'] === null ? null : (!empty($b['require_home_location']) ? 1 : 0))
        : 'unset';
    $require_any  = array_key_exists('require_any_location', $b)
        ? ($b['require_any_location']  === null ? null : (!empty($b['require_any_location'])  ? 1 : 0))
        : 'unset';

    // GPS coordinates
    $latitude  = array_key_exists('latitude',  $b)
        ? ($b['latitude']  !== null && $b['latitude']  !== '' ? (float)$b['latitude']  : null)
        : 'unset';
    $longitude = array_key_exists('longitude', $b)
        ? ($b['longitude'] !== null && $b['longitude'] !== '' ? (float)$b['longitude'] : null)
        : 'unset';

    if (!$id) json_error('id required');
    if ($status !== null && !in_array($status, ['available', 'checked-out', 'retired'], true)) {
        json_error('invalid status');
    }

    $sets   = [];
    $params = [];
    if ($status !== null)            { $sets[] = 'status = ?';            $params[] = $status; }
    if ($notes  !== null)            { $sets[] = 'notes = ?';             $params[] = $notes; }
    if ($route_position !== 'unset') { $sets[] = 'route_position = ?';   $params[] = $route_position; }
    if ($home_location_id !== false) { $sets[] = 'home_location_id = ?'; $params[] = $home_location_id; }
    if ($require_home     !== 'unset') { $sets[] = 'require_home_location = ?'; $params[] = $require_home; }
    if ($require_any      !== 'unset') { $sets[] = 'require_any_location = ?';  $params[] = $require_any; }
    if ($latitude         !== 'unset') { $sets[] = 'latitude = ?';        $params[] = $latitude; }
    if ($longitude        !== 'unset') { $sets[] = 'longitude = ?';       $params[] = $longitude; }

    if (empty($sets)) json_error('Nothing to update');

    $params[] = $id;
    $stmt = db()->prepare('UPDATE equipment_items SET ' . implode(', ', $sets) . ' WHERE id = ?');
    $stmt->execute($params);

    if ($stmt->rowCount() === 0) json_error('Item not found', 404);
    json_ok(['success' => true]);
}

function handle_bulk_update_items(): void {
    require_method('POST');
    require_permission('manage_equipment');
    verify_csrf();

    $b        = body();
    $item_ids = $b['item_ids'] ?? [];
    $fields   = $b['fields']   ?? [];

    if (!is_array($item_ids) || empty($item_ids)) json_error('item_ids required');
    if (!is_array($fields)   || empty($fields))   json_error('fields required');

    // Sanitize ids
    $item_ids = array_filter(array_map('intval', $item_ids));
    if (empty($item_ids)) json_error('No valid item ids');
    if (count($item_ids) > 500) json_error('Too many items — max 500');

    $allowed = ['home_location_id', 'require_home_location', 'require_any_location',
                'status', 'notes', 'latitude', 'longitude'];
    $sets    = [];
    $params  = [];

    foreach ($allowed as $key) {
        if (!array_key_exists($key, $fields)) continue;
        $val = $fields[$key];
        switch ($key) {
            case 'home_location_id':
                $sets[] = 'home_location_id = ?';
                $params[] = ($val !== null && $val !== '') ? (int)$val : null;
                break;
            case 'require_home_location':
            case 'require_any_location':
                $sets[] = "$key = ?";
                $params[] = $val === null ? null : (!empty($val) ? 1 : 0);
                break;
            case 'status':
                if (!in_array($val, ['available', 'checked-out', 'retired'], true)) continue 2;
                $sets[] = 'status = ?'; $params[] = $val;
                break;
            case 'notes':
                $sets[] = 'notes = ?'; $params[] = $val;
                break;
            case 'latitude':
            case 'longitude':
                $sets[] = "$key = ?";
                $params[] = ($val !== null && $val !== '') ? (float)$val : null;
                break;
        }
    }

    if (empty($sets)) json_error('No valid fields to update');

    $placeholders = implode(',', array_fill(0, count($item_ids), '?'));
    $params       = array_merge($params, $item_ids);

    $stmt = db()->prepare(
        'UPDATE equipment_items SET ' . implode(', ', $sets) .
        " WHERE id IN ($placeholders)"
    );
    $stmt->execute($params);

    json_ok(['updated' => $stmt->rowCount()]);
}

function handle_delete_item(): void {
    require_method('DELETE');
    require_admin();
    verify_csrf();

    $b  = body();
    $id = (int)($b['id'] ?? $_GET['id'] ?? 0);
    if (!$id) json_error('id required');

    // Soft delete — set to retired
    $stmt = db()->prepare('UPDATE equipment_items SET status = "retired", current_barrio_id = NULL WHERE id = ?');
    $stmt->execute([$id]);
    if ($stmt->rowCount() === 0) json_error('Item not found', 404);

    json_ok(['success' => true]);
}
