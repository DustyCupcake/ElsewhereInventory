<?php
declare(strict_types=1);

// Production checking out equipment to a department
function handle_checkout(): void {
    require_method('POST');
    $user = require_permission('checkout_equipment');
    verify_csrf();

    $b         = body();
    $dept_id   = (int)($b['dept_id'] ?? 0);
    $item_qrs  = $b['item_qrs'] ?? [];
    $force     = !empty($b['force']);
    $dept_label = isset($b['dept_label']) ? trim($b['dept_label']) : null;

    if (!$dept_id || empty($item_qrs) || !is_array($item_qrs)) {
        json_error('dept_id and item_qrs required');
    }

    $dept = db()->prepare('SELECT id FROM departments WHERE id = ? AND is_active = 1');
    $dept->execute([$dept_id]);
    if (!$dept->fetch()) json_error('Department not found', 404);

    $results = [];
    $now     = date('Y-m-d H:i:s');
    $pdo     = db();
    $pdo->beginTransaction();

    try {
        foreach ($item_qrs as $qr) {
            $qr   = (string)$qr;
            $stmt = $pdo->prepare(
                'SELECT id, status, current_dept_id, current_barrio_id, current_artist_id
                 FROM equipment_items WHERE qr_code = ? FOR UPDATE'
            );
            $stmt->execute([$qr]);
            $item = $stmt->fetch();

            if (!$item) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_found'];
                continue;
            }

            if ($item['status'] === 'checked-out' && !$force) {
                $loc = _item_location_label($pdo, $item);
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'already_checked_out', 'location' => $loc];
                continue;
            }

            if (!in_array($item['status'], ['available', 'checked-out'], true)) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_available'];
                continue;
            }

            $pdo->prepare(
                'UPDATE equipment_items
                 SET status = "checked-out", current_dept_id = ?, dept_label = ?,
                     current_barrio_id = NULL, current_artist_id = NULL
                 WHERE id = ?'
            )->execute([$dept_id, $dept_label ?: null, $item['id']]);

            $pdo->prepare(
                'INSERT INTO transactions (type, item_id, dept_id, performed_by, user_name_cache, occurred_at)
                 VALUES ("checkout", ?, ?, ?, ?, ?)'
            )->execute([$item['id'], $dept_id, $user['id'], $user['display_name'], $now]);

            $results[] = ['qr' => $qr, 'success' => true];
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_error('Database error: ' . $e->getMessage(), 500);
    }

    json_ok(['results' => $results]);
}

// Department lending equipment to a barrio or artist
function handle_sub_checkout(): void {
    require_method('POST');
    $user = require_permission('sub_checkout');
    verify_csrf();

    $b          = body();
    $dept_id    = (int)($b['dept_id'] ?? 0);
    $barrio_id  = isset($b['barrio_id'])  ? (int)$b['barrio_id']  : null;
    $artist_id  = isset($b['artist_id'])  ? (int)$b['artist_id']  : null;
    $item_qrs   = $b['item_qrs'] ?? [];
    $force      = !empty($b['force']);
    $dept_label = isset($b['dept_label']) ? trim($b['dept_label']) : null;

    if (!$dept_id || (!$barrio_id && !$artist_id) || empty($item_qrs) || !is_array($item_qrs)) {
        json_error('dept_id, one of barrio_id/artist_id, and item_qrs required');
    }

    // Verify dept access
    if (!has_permission('checkout_equipment')) {
        require_dept_access($dept_id);
    }

    $results = [];
    $now     = date('Y-m-d H:i:s');
    $pdo     = db();
    $pdo->beginTransaction();

    try {
        foreach ($item_qrs as $qr) {
            $qr   = (string)$qr;
            $stmt = $pdo->prepare(
                'SELECT id, status, current_dept_id, current_barrio_id, current_artist_id
                 FROM equipment_items WHERE qr_code = ? FOR UPDATE'
            );
            $stmt->execute([$qr]);
            $item = $stmt->fetch();

            if (!$item) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_found'];
                continue;
            }

            if ((int)$item['current_dept_id'] !== $dept_id) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_in_dept'];
                continue;
            }

            if (($item['current_barrio_id'] || $item['current_artist_id']) && !$force) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'already_sub_lent'];
                continue;
            }

            $pdo->prepare(
                'UPDATE equipment_items
                 SET current_barrio_id = ?, current_artist_id = ?, dept_label = COALESCE(?, dept_label)
                 WHERE id = ?'
            )->execute([$barrio_id, $artist_id, $dept_label ?: null, $item['id']]);

            $pdo->prepare(
                'INSERT INTO transactions (type, item_id, dept_id, barrio_id, artist_id,
                                           performed_by, user_name_cache, occurred_at)
                 VALUES ("sub_checkout", ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $item['id'], $dept_id, $barrio_id, $artist_id,
                $user['id'], $user['display_name'], $now,
            ]);

            $results[] = ['qr' => $qr, 'success' => true];
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_error('Database error: ' . $e->getMessage(), 500);
    }

    json_ok(['results' => $results]);
}

// Unified check-in: auto-detects whether to do sub_checkin or full checkin
function handle_checkin(): void {
    require_method('POST');
    $user    = require_auth();
    verify_csrf();

    $b       = body();
    $item_qr = trim($b['item_qr'] ?? '');

    if ($item_qr === '') json_error('item_qr required');

    $stmt = db()->prepare(
        'SELECT id, status, current_dept_id, current_barrio_id, current_artist_id, current_person_id
         FROM equipment_items WHERE qr_code = ?'
    );
    $stmt->execute([$item_qr]);
    $item = $stmt->fetch();

    if (!$item) json_error('Item not found', 404);

    if (!in_array($item['status'], ['checked-out', 'activated'], true)) {
        json_ok(['success' => false, 'error' => 'not_checked_out']);
        return;
    }

    $dept_id      = $item['current_dept_id']    ? (int)$item['current_dept_id']    : null;
    $barrio_id    = $item['current_barrio_id']  ? (int)$item['current_barrio_id']  : null;
    $artist_id    = $item['current_artist_id']  ? (int)$item['current_artist_id']  : null;
    $person_id    = $item['current_person_id']  ? (int)$item['current_person_id']  : null;

    // Sub-lent = in dept pool then further lent to barrio/artist/person
    $is_sub_lent  = (bool)($barrio_id || $artist_id || ($person_id && $dept_id));
    // Person-from-production = no dept, just person
    $is_person_prod = $person_id && !$dept_id;

    // Permission check
    if ($is_sub_lent || $is_person_prod) {
        if (!has_permission('sub_checkin') && !has_permission('checkin_equipment')) {
            json_error('Forbidden', 403);
        }
    } else {
        if (!has_permission('checkin_equipment')) {
            json_error('Forbidden', 403);
        }
    }

    // Dept access check for non-production users
    if (!has_permission('checkin_equipment') && $dept_id) {
        require_dept_access($dept_id);
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        if ($is_person_prod) {
            // Return from production person back to production pool
            $pdo->prepare(
                'UPDATE equipment_items
                 SET status = "available", current_person_id = NULL, dept_label = NULL
                 WHERE id = ?'
            )->execute([$item['id']]);

            $pdo->prepare(
                'INSERT INTO transactions (type, item_id, person_id, performed_by, user_name_cache, occurred_at)
                 VALUES ("person_checkin", ?, ?, ?, ?, NOW())'
            )->execute([$item['id'], $person_id, $user['id'], $user['display_name']]);

        } elseif ($is_sub_lent) {
            // Return from sub-level (barrio/artist/person) back to dept pool
            $pdo->prepare(
                'UPDATE equipment_items
                 SET current_barrio_id = NULL, current_artist_id = NULL, current_person_id = NULL
                 WHERE id = ?'
            )->execute([$item['id']]);

            $tx_type = $person_id ? 'person_checkin' : 'sub_checkin';
            $pdo->prepare(
                'INSERT INTO transactions (type, item_id, dept_id, barrio_id, artist_id, person_id,
                                           performed_by, user_name_cache, occurred_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())'
            )->execute([
                $tx_type, $item['id'], $dept_id, $barrio_id, $artist_id, $person_id,
                $user['id'], $user['display_name'],
            ]);

        } else {
            // Return from dept pool back to production pool
            $pdo->prepare(
                'UPDATE equipment_items
                 SET status = "available", current_dept_id = NULL, dept_label = NULL,
                     current_barrio_id = NULL, current_artist_id = NULL, current_person_id = NULL
                 WHERE id = ?'
            )->execute([$item['id']]);

            $pdo->prepare(
                'INSERT INTO transactions (type, item_id, dept_id, performed_by, user_name_cache, occurred_at)
                 VALUES ("checkin", ?, ?, ?, ?, NOW())'
            )->execute([$item['id'], $dept_id, $user['id'], $user['display_name']]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_error('Database error: ' . $e->getMessage(), 500);
    }

    $tier = $is_person_prod ? 'person_prod' : ($is_sub_lent ? 'sub' : 'dept');
    json_ok(['success' => true, 'tier' => $tier]);
}

// Production lending equipment directly to a named person
function handle_person_checkout(): void {
    require_method('POST');
    $user = require_permission('checkout_equipment');
    verify_csrf();

    $b          = body();
    $person_qr  = trim($b['person_qr'] ?? '');
    $item_qrs   = $b['item_qrs'] ?? [];
    $force      = !empty($b['force']);
    $dept_label = isset($b['dept_label']) ? trim($b['dept_label']) : null;

    if ($person_qr === '' || empty($item_qrs) || !is_array($item_qrs)) {
        json_error('person_qr and item_qrs required');
    }

    $person_stmt = db()->prepare(
        'SELECT id, display_name FROM users WHERE qr_token = ? AND is_active = 1'
    );
    $person_stmt->execute([$person_qr]);
    $person = $person_stmt->fetch();
    if (!$person) json_error('Person QR not found', 404);

    $results = [];
    $now     = date('Y-m-d H:i:s');
    $pdo     = db();
    $pdo->beginTransaction();

    try {
        foreach ($item_qrs as $qr) {
            $qr   = (string)$qr;
            $stmt = $pdo->prepare(
                'SELECT id, status, current_dept_id, current_barrio_id, current_artist_id, current_person_id
                 FROM equipment_items WHERE qr_code = ? FOR UPDATE'
            );
            $stmt->execute([$qr]);
            $item = $stmt->fetch();

            if (!$item) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_found'];
                continue;
            }
            if ($item['status'] === 'checked-out' && !$force) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'already_checked_out',
                              'location' => _item_location_label($pdo, $item)];
                continue;
            }
            if (!in_array($item['status'], ['available', 'checked-out'], true)) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_available'];
                continue;
            }

            // Verify the item type is borrowable and the person being checked out to is eligible
            $tr_stmt = $pdo->prepare('SELECT borrowable FROM equipment_types WHERE id = (SELECT equipment_type_id FROM equipment_items WHERE id = ?)');
            $tr_stmt->execute([$item['id']]);
            $type_row = $tr_stmt->fetch();
            if (empty($type_row['borrowable'])) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_borrowable'];
                continue;
            }

            $pdo->prepare(
                'UPDATE equipment_items
                 SET status = "checked-out", current_person_id = ?, dept_label = ?,
                     current_dept_id = NULL, current_barrio_id = NULL, current_artist_id = NULL
                 WHERE id = ?'
            )->execute([(int)$person['id'], $dept_label ?: null, $item['id']]);

            $pdo->prepare(
                'INSERT INTO transactions (type, item_id, person_id, performed_by, user_name_cache, occurred_at)
                 VALUES ("person_checkout", ?, ?, ?, ?, ?)'
            )->execute([$item['id'], (int)$person['id'], $user['id'], $user['display_name'], $now]);

            $results[] = ['qr' => $qr, 'success' => true];
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_error('Database error: ' . $e->getMessage(), 500);
    }

    json_ok(['results' => $results, 'person' => ['id' => (int)$person['id'], 'display_name' => $person['display_name']]]);
}

// Department lending equipment from its pool to a named person
function handle_sub_person_checkout(): void {
    require_method('POST');
    $user = require_permission('sub_checkout');
    verify_csrf();

    $b          = body();
    $dept_id    = (int)($b['dept_id'] ?? 0);
    $person_qr  = trim($b['person_qr'] ?? '');
    $item_qrs   = $b['item_qrs'] ?? [];
    $force      = !empty($b['force']);
    $dept_label = isset($b['dept_label']) ? trim($b['dept_label']) : null;

    if (!$dept_id || $person_qr === '' || empty($item_qrs) || !is_array($item_qrs)) {
        json_error('dept_id, person_qr, and item_qrs required');
    }

    if (!has_permission('checkout_equipment')) {
        require_dept_access($dept_id);
    }

    $person_stmt = db()->prepare(
        'SELECT id, display_name FROM users WHERE qr_token = ? AND is_active = 1'
    );
    $person_stmt->execute([$person_qr]);
    $person = $person_stmt->fetch();
    if (!$person) json_error('Person QR not found', 404);

    $results = [];
    $now     = date('Y-m-d H:i:s');
    $pdo     = db();
    $pdo->beginTransaction();

    try {
        foreach ($item_qrs as $qr) {
            $qr   = (string)$qr;
            $stmt = $pdo->prepare(
                'SELECT id, status, current_dept_id, current_barrio_id, current_artist_id, current_person_id
                 FROM equipment_items WHERE qr_code = ? FOR UPDATE'
            );
            $stmt->execute([$qr]);
            $item = $stmt->fetch();

            if (!$item) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_found'];
                continue;
            }
            if ((int)$item['current_dept_id'] !== $dept_id) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'not_in_dept'];
                continue;
            }
            if (($item['current_barrio_id'] || $item['current_artist_id'] || $item['current_person_id']) && !$force) {
                $results[] = ['qr' => $qr, 'success' => false, 'error' => 'already_sub_lent'];
                continue;
            }

            $pdo->prepare(
                'UPDATE equipment_items
                 SET current_person_id = ?, dept_label = COALESCE(?, dept_label),
                     current_barrio_id = NULL, current_artist_id = NULL
                 WHERE id = ?'
            )->execute([(int)$person['id'], $dept_label ?: null, $item['id']]);

            $pdo->prepare(
                'INSERT INTO transactions (type, item_id, dept_id, person_id, performed_by, user_name_cache, occurred_at)
                 VALUES ("person_checkout", ?, ?, ?, ?, ?, ?)'
            )->execute([$item['id'], $dept_id, (int)$person['id'], $user['id'], $user['display_name'], $now]);

            $results[] = ['qr' => $qr, 'success' => true];
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_error('Database error: ' . $e->getMessage(), 500);
    }

    json_ok(['results' => $results, 'person' => ['id' => (int)$person['id'], 'display_name' => $person['display_name']]]);
}

// Set or update the dept label on a checked-out item
function handle_set_label(): void {
    require_method('PUT');
    $user = require_permission('label_equipment');
    verify_csrf();

    $b       = body();
    $item_qr = trim($b['item_qr'] ?? '');
    $label   = trim($b['label'] ?? '');

    if ($item_qr === '') json_error('item_qr required');

    $stmt = db()->prepare(
        'SELECT id, current_dept_id FROM equipment_items WHERE qr_code = ? AND status = "checked-out"'
    );
    $stmt->execute([$item_qr]);
    $item = $stmt->fetch();

    if (!$item) json_error('Item not found or not checked out', 404);

    // Verify dept access for non-production users
    if (!has_permission('checkout_equipment') && $item['current_dept_id']) {
        require_dept_access((int)$item['current_dept_id']);
    }

    db()->prepare(
        'UPDATE equipment_items SET dept_label = ? WHERE id = ?'
    )->execute([$label ?: null, $item['id']]);

    json_ok(['success' => true, 'label' => $label ?: null]);
}

function handle_used(): void {
    require_method('POST');
    $user = require_permission('validate_vouchers');
    verify_csrf();

    $b       = body();
    $item_qr = trim($b['item_qr'] ?? '');

    if ($item_qr === '') json_error('item_qr required');

    $stmt = db()->prepare(
        'SELECT i.id, i.status, i.current_barrio_id, i.current_dept_id, t.secure_qr
         FROM equipment_items i
         JOIN equipment_types t ON t.id = i.equipment_type_id
         WHERE i.qr_code = ?'
    );
    $stmt->execute([$item_qr]);
    $item = $stmt->fetch();

    if (!$item) json_error('Item not found', 404);
    if (!$item['secure_qr']) json_error('Not a secure QR item', 409);
    if ($item['status'] !== 'activated') {
        json_ok(['success' => false, 'error' => 'not_activated']);
        return;
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'UPDATE equipment_items SET status = "used", current_barrio_id = NULL WHERE id = ?'
        )->execute([$item['id']]);

        $pdo->prepare(
            'INSERT INTO transactions (type, item_id, dept_id, barrio_id, performed_by, user_name_cache, occurred_at)
             VALUES ("used", ?, ?, ?, ?, ?, NOW())'
        )->execute([
            $item['id'], $item['current_dept_id'], $item['current_barrio_id'],
            $user['id'], $user['display_name'],
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_error('Database error: ' . $e->getMessage(), 500);
    }

    json_ok(['success' => true]);
}

function handle_fill_confirm(): void {
    require_method('POST');
    $user = require_auth();
    verify_csrf();

    $b        = body();
    $item_qrs = $b['item_qrs'] ?? [];
    $flagged  = !empty($b['flagged']);
    $notes    = isset($b['notes']) ? trim((string)$b['notes']) : null;

    if (empty($item_qrs) || !is_array($item_qrs)) {
        json_error('item_qrs required');
    }

    $type = $flagged ? 'fill_flagged' : 'fill_confirmed';
    $now  = date('Y-m-d H:i:s');
    $pdo  = db();
    $pdo->beginTransaction();

    try {
        foreach ($item_qrs as $qr) {
            $qr   = (string)$qr;
            $stmt = $pdo->prepare(
                'SELECT i.id, i.status, i.current_barrio_id, i.current_dept_id, t.secure_qr
                 FROM equipment_items i
                 JOIN equipment_types t ON t.id = i.equipment_type_id
                 WHERE i.qr_code = ?'
            );
            $stmt->execute([$qr]);
            $item = $stmt->fetch();

            if (!$item || !$item['secure_qr'] || $item['status'] !== 'used') continue;

            $pdo->prepare(
                'INSERT INTO transactions (type, item_id, dept_id, barrio_id, performed_by, user_name_cache, occurred_at, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $type, $item['id'], $item['current_dept_id'], $item['current_barrio_id'],
                $user['id'], $user['display_name'], $now, $notes ?: null,
            ]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_error('Database error: ' . $e->getMessage(), 500);
    }

    json_ok(['success' => true, 'confirmed' => count($item_qrs), 'flagged' => $flagged]);
}

function handle_activate(): void {
    require_method('POST');
    $user = require_auth();
    verify_csrf();

    $b       = body();
    $item_qr = trim($b['item_qr'] ?? '');

    if ($item_qr === '') json_error('item_qr required');

    $stmt = db()->prepare(
        'SELECT i.id, i.status, i.current_barrio_id, i.current_dept_id, t.secure_qr,
                CONCAT(t.name, " #", i.item_number) AS display_name,
                b.name AS barrio_name
         FROM equipment_items i
         JOIN equipment_types t ON t.id = i.equipment_type_id
         LEFT JOIN barrios b ON b.id = i.current_barrio_id
         WHERE i.qr_code = ?'
    );
    $stmt->execute([$item_qr]);
    $item = $stmt->fetch();

    if (!$item) json_error('Item not found', 404);
    if (!$item['secure_qr']) json_error('Not a voucher', 409);

    if ($item['status'] === 'activated') {
        json_ok(['success' => false, 'error' => 'already_activated',
                 'name' => $item['display_name'], 'barrio' => $item['barrio_name']]);
        return;
    }
    if ($item['status'] !== 'checked-out') {
        json_ok(['success' => false, 'error' => 'not_checked_out', 'name' => $item['display_name']]);
        return;
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'UPDATE equipment_items SET status = "activated" WHERE id = ?'
        )->execute([$item['id']]);

        $pdo->prepare(
            'INSERT INTO transactions (type, item_id, dept_id, barrio_id, performed_by, user_name_cache, occurred_at)
             VALUES ("activated", ?, ?, ?, ?, ?, NOW())'
        )->execute([
            $item['id'], $item['current_dept_id'], $item['current_barrio_id'],
            $user['id'], $user['display_name'],
        ]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        json_error('Database error: ' . $e->getMessage(), 500);
    }

    json_ok(['success' => true, 'name' => $item['display_name'], 'barrio' => $item['barrio_name']]);
}

// Helper: build human-readable current location label for an item
function _item_location_label(object $pdo, array $item): string {
    if (!empty($item['current_person_id'])) {
        $r_stmt = $pdo->prepare('SELECT display_name FROM users WHERE id = ?');
        $r_stmt->execute([$item['current_person_id']]);
        $r = $r_stmt->fetch();
        return $r ? $r['display_name'] : 'unknown person';
    }
    if (!empty($item['current_barrio_id'])) {
        $r_stmt = $pdo->prepare('SELECT name FROM barrios WHERE id = ?');
        $r_stmt->execute([$item['current_barrio_id']]);
        $r = $r_stmt->fetch();
        return $r ? $r['name'] : 'unknown barrio';
    }
    if (!empty($item['current_artist_id'])) {
        $r_stmt = $pdo->prepare('SELECT name FROM artists WHERE id = ?');
        $r_stmt->execute([$item['current_artist_id']]);
        $r = $r_stmt->fetch();
        return $r ? $r['name'] : 'unknown artist';
    }
    if (!empty($item['current_dept_id'])) {
        $r_stmt = $pdo->prepare('SELECT name FROM departments WHERE id = ?');
        $r_stmt->execute([$item['current_dept_id']]);
        $r = $r_stmt->fetch();
        return $r ? $r['name'] : 'unknown dept';
    }
    return 'unknown';
}
