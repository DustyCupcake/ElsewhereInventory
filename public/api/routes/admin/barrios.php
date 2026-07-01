<?php
declare(strict_types=1);

function handle_list(): void {
    require_method('GET');
    require_permission('manage_barrios');

    $rows = db()->query('SELECT id, name, sort_order, arrival_status, created_at FROM barrios ORDER BY sort_order, name')->fetchAll();
    foreach ($rows as &$r) $r['id'] = (int)$r['id'];
    unset($r);
    json_ok(['barrios' => $rows]);
}

function handle_create(): void {
    require_method('POST');
    require_permission('manage_barrios');
    verify_csrf();

    $b    = body();
    $name = trim($b['name'] ?? '');
    $sort = (int)($b['sort_order'] ?? 0);

    if ($name === '') json_error('name required');

    $qr_code = bin2hex(random_bytes(12));

    // Assign to the department that manages barrios, so dept-scoped staff
    // (permission view_barrios without production-level view_inventory) can see it.
    $dept_stmt = db()->prepare("SELECT id FROM departments WHERE sub_entity = 'barrio' ORDER BY id LIMIT 1");
    $dept_stmt->execute();
    $dept_id = $dept_stmt->fetchColumn();
    $dept_id = $dept_id !== false ? (int)$dept_id : null;

    try {
        $stmt = db()->prepare('INSERT INTO barrios (name, qr_code, sort_order, dept_id) VALUES (?, ?, ?, ?)');
        $stmt->execute([$name, $qr_code, $sort, $dept_id]);
        $id = (int)db()->lastInsertId();
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) json_error('Name already exists', 409);
        throw $e;
    }

    json_ok(['id' => $id, 'name' => $name, 'qr_code' => $qr_code, 'sort_order' => $sort], 201);
}

function handle_update(): void {
    require_method('PUT');
    require_permission('manage_barrios');
    verify_csrf();

    $b      = body();
    $id     = (int)($b['id'] ?? $_GET['id'] ?? 0);
    $name   = trim($b['name'] ?? '');
    $sort   = (int)($b['sort_order'] ?? 0);
    $status = $b['arrival_status'] ?? null;

    if (!$id || $name === '') json_error('id and name required');

    $valid_statuses = ['expected', 'on-site', 'departed'];
    if ($status !== null && !in_array($status, $valid_statuses, true)) {
        json_error('Invalid arrival_status');
    }

    try {
        if ($status !== null) {
            $stmt = db()->prepare('UPDATE barrios SET name = ?, sort_order = ?, arrival_status = ? WHERE id = ?');
            $stmt->execute([$name, $sort, $status, $id]);
        } else {
            $stmt = db()->prepare('UPDATE barrios SET name = ?, sort_order = ? WHERE id = ?');
            $stmt->execute([$name, $sort, $id]);
        }
    } catch (PDOException $e) {
        if (str_contains($e->getMessage(), 'Duplicate')) json_error('Name already exists', 409);
        throw $e;
    }

    if ($stmt->rowCount() === 0) json_error('Barrio not found', 404);
    json_ok(['success' => true]);
}

function handle_delete(): void {
    require_method('DELETE');
    require_permission('manage_barrios');
    verify_csrf();

    $b  = body();
    $id = (int)($b['id'] ?? $_GET['id'] ?? 0);
    if (!$id) json_error('id required');

    // Check for active checkouts
    $count = db()->prepare('SELECT COUNT(*) FROM equipment_items WHERE current_barrio_id = ?');
    $count->execute([$id]);
    if ((int)$count->fetchColumn() > 0) {
        json_error('Cannot delete — items are currently checked out to this barrio', 409);
    }

    db()->prepare('DELETE FROM barrios WHERE id = ?')->execute([$id]);
    json_ok(['success' => true]);
}

// ─── POST /admin/barrios/import-locations-csv ─────────────────────────────────
// Import barrio locations from a CSV file.
// Required columns: barrio_name, location_name, latitude, longitude
// Upserts storage_locations rows keyed by (barrio_id, name).
function handle_import_locations_csv(): void {
    require_method('POST');
    require_permission('manage_barrios');
    verify_csrf();

    if (empty($_FILES['file']['tmp_name'])) json_error('No file uploaded');

    $fh = fopen($_FILES['file']['tmp_name'], 'r');
    if (!$fh) json_error('Failed to read file');

    $header = fgetcsv($fh);
    if (!$header) { fclose($fh); json_error('Empty CSV'); }

    $header = array_map('strtolower', array_map('trim', $header));
    $required = ['barrio_name', 'location_name', 'latitude', 'longitude'];
    foreach ($required as $col) {
        if (!in_array($col, $header, true)) {
            fclose($fh);
            json_error("Missing required column: $col");
        }
    }
    $idx = array_flip($header);

    // Cache barrio name → id (case-insensitive)
    $barrio_map = [];
    $rows = db()->query('SELECT id, LOWER(name) AS lname FROM barrios')->fetchAll();
    foreach ($rows as $r) $barrio_map[$r['lname']] = (int)$r['id'];

    $pdo = db();
    $created = 0; $updated = 0; $skipped = 0; $errors = [];
    $line = 1;

    while (($row = fgetcsv($fh)) !== false) {
        $line++;
        $barrio_name   = strtolower(trim($row[$idx['barrio_name']]   ?? ''));
        $location_name = trim($row[$idx['location_name']] ?? '');
        $lat_raw       = trim($row[$idx['latitude']]      ?? '');
        $lng_raw       = trim($row[$idx['longitude']]     ?? '');

        if ($barrio_name === '' || $location_name === '' || $lat_raw === '' || $lng_raw === '') {
            $skipped++;
            continue;
        }

        if (!isset($barrio_map[$barrio_name])) {
            $errors[] = "Line $line: barrio not found — \"$barrio_name\"";
            continue;
        }

        if (!is_numeric($lat_raw) || !is_numeric($lng_raw)) {
            $errors[] = "Line $line: invalid lat/lng — \"$lat_raw\", \"$lng_raw\"";
            continue;
        }

        $barrio_id = $barrio_map[$barrio_name];
        $lat       = (float)$lat_raw;
        $lng       = (float)$lng_raw;

        // Check for existing location with same barrio + name
        $stmt = $pdo->prepare('SELECT id FROM storage_locations WHERE barrio_id = ? AND name = ?');
        $stmt->execute([$barrio_id, $location_name]);
        $existing = $stmt->fetch();

        if ($existing) {
            $stmt = $pdo->prepare('UPDATE storage_locations SET latitude = ?, longitude = ? WHERE id = ?');
            $stmt->execute([$lat, $lng, (int)$existing['id']]);
            $updated++;
        } else {
            $qr_code = bin2hex(random_bytes(12));
            $stmt = $pdo->prepare(
                'INSERT INTO storage_locations (barrio_id, name, latitude, longitude, qr_code) VALUES (?, ?, ?, ?, ?)'
            );
            $stmt->execute([$barrio_id, $location_name, $lat, $lng, $qr_code]);
            $created++;
        }
    }

    fclose($fh);
    json_ok(['created' => $created, 'updated' => $updated, 'skipped' => $skipped, 'errors' => $errors]);
}
