<?php
declare(strict_types=1);

/**
 * Unified QR code lookup. No auth required — returns public info for anyone,
 * richer detail when a session is present.
 *
 * Lookup order: equipment item → user (person QR) → barrio → department
 */
function handle_scan_lookup(): void {
    require_method('GET');

    $qr = trim($_GET['qr'] ?? '');
    if ($qr === '') json_error('qr required');

    // Determine auth state without hard-requiring login
    start_session();
    $authed = !empty($_SESSION['user_id']) || !empty($_SESSION['is_shift']);
    $perms  = [];
    $user   = null;
    if ($authed) {
        $user  = $_SESSION['_auth_cache'] ?? _build_auth_return();
        $perms = $user['permissions'] ?? [];
    }

    // ── 1. Equipment item ────────────────────────────────────────────────────
    $stmt = db()->prepare(
        'SELECT i.id, i.qr_code, i.status, i.notes, i.equipment_type_id, i.dept_label,
                i.current_dept_id, i.current_barrio_id, i.current_artist_id, i.current_person_id,
                t.name AS type_name, t.category, t.secure_qr, t.borrowable,
                b.name AS barrio_name,
                d.name AS dept_name,
                a.name AS artist_name,
                p.display_name AS person_name,
                CONCAT(t.name, " #", i.item_number) AS display_name
         FROM equipment_items i
         JOIN equipment_types t ON t.id = i.equipment_type_id
         LEFT JOIN barrios     b ON b.id = i.current_barrio_id
         LEFT JOIN departments d ON d.id = i.current_dept_id
         LEFT JOIN artists     a ON a.id = i.current_artist_id
         LEFT JOIN users       p ON p.id = i.current_person_id
         WHERE i.qr_code = ?'
    );
    $stmt->execute([$qr]);
    if ($item = $stmt->fetch()) {
        $is_voucher = (bool)$item['secure_qr'];
        $result = [
            'type'      => 'item',
            'name'      => $item['display_name'],
            'category'  => $item['category'],
            'status'    => $item['status'],
            'is_voucher'=> $is_voucher,
        ];

        if ($authed) {
            $result['id']              = (int)$item['id'];
            $result['qr_code']         = $item['qr_code'];
            $result['dept_label']      = $item['dept_label'];
            $result['borrowable']      = (bool)$item['borrowable'];
            $result['current_dept']    = $item['current_dept_id']
                ? ['id' => (int)$item['current_dept_id'],   'name' => $item['dept_name']]   : null;
            $result['current_barrio']  = $item['current_barrio_id']
                ? ['id' => (int)$item['current_barrio_id'], 'name' => $item['barrio_name']] : null;
            $result['current_artist']  = $item['current_artist_id']
                ? ['id' => (int)$item['current_artist_id'], 'name' => $item['artist_name']] : null;
            $result['current_person']  = $item['current_person_id']
                ? ['id' => (int)$item['current_person_id'], 'name' => $item['person_name']] : null;

            if ($item['borrowable']) {
                $eligibility = check_borrow_eligible(
                    (int)$item['id'],
                    (int)$item['equipment_type_id']
                );
                $result['borrow_eligible'] = $eligibility['eligible'];
                $result['borrow_reason']   = $eligibility['reason'] ?? null;
            }
        }
        json_ok($result);
    }

    // ── 2. Person (user qr_token) ────────────────────────────────────────────
    $stmt = db()->prepare(
        'SELECT id, display_name, qr_token FROM users WHERE qr_token = ? AND is_active = 1'
    );
    $stmt->execute([$qr]);
    if ($person = $stmt->fetch()) {
        $result = [
            'type' => 'person',
            'name' => $person['display_name'],
        ];
        if ($authed) {
            $result['id']       = (int)$person['id'];
            $result['qr_token'] = $person['qr_token'];

            if (in_array('manage_users', $perms, true) || in_array('manage_dept_users', $perms, true)) {
                $mem_stmt = db()->prepare(
                    'SELECT d.id, d.name, udr.role
                     FROM user_dept_roles udr
                     JOIN departments d ON d.id = udr.dept_id
                     WHERE udr.user_id = ?
                     ORDER BY d.name'
                );
                $mem_stmt->execute([$person['id']]);
                $memberships = $mem_stmt->fetchAll();
                $result['dept_memberships'] = array_map(
                    fn($m) => ['id' => (int)$m['id'], 'name' => $m['name'], 'role' => $m['role']],
                    $memberships
                );
            }
        }
        json_ok($result);
    }

    // ── 3. Barrio ────────────────────────────────────────────────────────────
    $stmt = db()->prepare(
        'SELECT id, name, arrival_status FROM barrios WHERE qr_code = ?'
    );
    $stmt->execute([$qr]);
    if ($barrio = $stmt->fetch()) {
        $result = [
            'type'           => 'barrio',
            'name'           => $barrio['name'],
            'arrival_status' => $barrio['arrival_status'],
        ];
        if ($authed) {
            $result['id'] = (int)$barrio['id'];

            if (in_array('view_barrios', $perms, true)) {
                $ic_stmt = db()->prepare(
                    'SELECT COUNT(*) FROM equipment_items WHERE current_barrio_id = ?'
                );
                $ic_stmt->execute([$barrio['id']]);
                $item_count = (int)$ic_stmt->fetchColumn();
                $result['item_count'] = $item_count;
            }
        }
        json_ok($result);
    }

    // ── 4. Department ────────────────────────────────────────────────────────
    $stmt = db()->prepare(
        'SELECT id, name, sub_entity FROM departments WHERE qr_code = ? AND is_active = 1'
    );
    $stmt->execute([$qr]);
    if ($dept = $stmt->fetch()) {
        $result = [
            'type'       => 'department',
            'name'       => $dept['name'],
            'sub_entity' => $dept['sub_entity'],
        ];
        if ($authed) {
            $result['id'] = (int)$dept['id'];

            if (in_array('manage_departments', $perms, true) || in_array('manage_dept_users', $perms, true)) {
                $mc_stmt = db()->prepare(
                    'SELECT COUNT(*) FROM user_dept_roles WHERE dept_id = ?'
                );
                $mc_stmt->execute([$dept['id']]);
                $member_count = (int)$mc_stmt->fetchColumn();
                $result['member_count'] = $member_count;
            }
        }
        json_ok($result);
    }

    // ── Nothing found ────────────────────────────────────────────────────────
    json_ok(['type' => 'unknown']);
}
