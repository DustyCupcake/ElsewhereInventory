<?php
declare(strict_types=1);

// ─── QR Print Template endpoints ─────────────────────────────────────────────

function _qrt_storage_dir(): string {
    return __DIR__ . '/../../../storage/qr_templates/';
}

function _qrt_load_template(int $id): array {
    $stmt = db()->prepare('SELECT * FROM qr_templates WHERE id = ?');
    $stmt->execute([$id]);
    $tmpl = $stmt->fetch();
    if (!$tmpl) json_error('Template not found', 404);
    return $tmpl;
}

// GET /admin/qr-templates
function handle_qrt_list(): void {
    require_method('GET');
    require_permission('manage_equipment');

    $stmt = db()->prepare('SELECT id, name, item_filter, created_at FROM qr_templates ORDER BY name');
    $stmt->execute();
    json_ok(['templates' => $stmt->fetchAll()]);
}

// POST /admin/qr-templates  (multipart/form-data: name, item_filter, file)
function handle_qrt_create(): void {
    require_method('POST');
    require_permission('manage_equipment');
    verify_csrf();

    $name        = trim($_POST['name'] ?? '');
    $item_filter = trim($_POST['item_filter'] ?? '') ?: null;
    if (!$name) json_error('Name is required', 422);

    if (empty($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        json_error('File upload failed', 422);
    }

    $file    = $_FILES['file'];
    $mime    = mime_content_type($file['tmp_name']);
    $allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    if (!in_array($mime, $allowed, true)) {
        json_error('Only PDF, PNG and JPEG files are accepted', 422);
    }

    $ext = match($mime) {
        'application/pdf' => 'pdf',
        'image/png'       => 'png',
        default           => 'jpg',
    };
    $filename = bin2hex(random_bytes(16)) . '.' . $ext;
    $dest     = _qrt_storage_dir() . $filename;

    if (!is_dir(_qrt_storage_dir())) {
        mkdir(_qrt_storage_dir(), 0755, true);
    }
    if (!move_uploaded_file($file['tmp_name'], $dest)) {
        json_error('Failed to save file', 500);
    }

    $stmt = db()->prepare('INSERT INTO qr_templates (name, pdf_filename, item_filter) VALUES (?, ?, ?)');
    $stmt->execute([$name, $filename, $item_filter]);
    $id = (int)db()->lastInsertId();

    json_ok(['id' => $id, 'name' => $name, 'item_filter' => $item_filter, 'pdf_filename' => $filename]);
}

// DELETE /admin/qr-templates/:id
function handle_qrt_delete(): void {
    require_method('DELETE');
    require_permission('manage_equipment');
    verify_csrf();

    $id   = (int)($_GET['id'] ?? 0);
    $tmpl = _qrt_load_template($id);

    $file = _qrt_storage_dir() . $tmpl['pdf_filename'];
    if (file_exists($file)) unlink($file);

    $stmt = db()->prepare('DELETE FROM qr_templates WHERE id = ?');
    $stmt->execute([$id]);

    json_ok(['deleted' => true]);
}

// GET /admin/qr-templates/:id/preview  — serves the raw PDF/image file
function handle_qrt_preview(): void {
    require_method('GET');
    require_permission('manage_equipment');

    $id   = (int)($_GET['id'] ?? 0);
    $tmpl = _qrt_load_template($id);

    $file = _qrt_storage_dir() . $tmpl['pdf_filename'];
    if (!file_exists($file)) json_error('File not found', 404);

    $ext  = strtolower(pathinfo($tmpl['pdf_filename'], PATHINFO_EXTENSION));
    $mime = match($ext) {
        'pdf'  => 'application/pdf',
        'png'  => 'image/png',
        default => 'image/jpeg',
    };

    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($file));
    header('Cache-Control: private, max-age=300');
    readfile($file);
    exit;
}

// GET /admin/qr-templates/:id/zones
function handle_qrt_get_zones(): void {
    require_method('GET');
    require_permission('manage_equipment');

    $id = (int)($_GET['id'] ?? 0);
    _qrt_load_template($id); // 404 if missing

    $stmt = db()->prepare(
        'SELECT id, zone_type, page, x_mm, y_mm, size_mm, custom_value, font_size
         FROM qr_template_zones WHERE template_id = ? ORDER BY page, id'
    );
    $stmt->execute([$id]);
    json_ok(['zones' => $stmt->fetchAll()]);
}

// PUT /admin/qr-templates/:id/zones  — replaces all zones for this template
function handle_qrt_save_zones(): void {
    require_method('PUT');
    require_permission('manage_equipment');
    verify_csrf();

    $id   = (int)($_GET['id'] ?? 0);
    _qrt_load_template($id);

    $body  = body();
    $zones = $body['zones'] ?? [];

    $valid_types = ['qr_code', 'item_number', 'item_name', 'custom_text'];

    db()->beginTransaction();
    try {
        $del = db()->prepare('DELETE FROM qr_template_zones WHERE template_id = ?');
        $del->execute([$id]);

        $ins = db()->prepare(
            'INSERT INTO qr_template_zones (template_id, zone_type, page, x_mm, y_mm, size_mm, custom_value, font_size)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($zones as $z) {
            $zone_type = $z['zone_type'] ?? '';
            if (!in_array($zone_type, $valid_types, true)) continue;
            $ins->execute([
                $id,
                $zone_type,
                max(1, (int)($z['page'] ?? 1)),
                (float)($z['x_mm'] ?? 0),
                (float)($z['y_mm'] ?? 0),
                max(1.0, (float)($z['size_mm'] ?? 30)),
                $zone_type === 'custom_text' ? (string)($z['custom_value'] ?? '') : null,
                max(6, min(72, (int)($z['font_size'] ?? 12))),
            ]);
        }
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }

    json_ok(['saved' => true]);
}

// POST /admin/qr-templates/:id/generate
function handle_qrt_generate(): void {
    require_method('POST');
    require_permission('manage_equipment');
    verify_csrf();

    $id   = (int)($_GET['id'] ?? 0);
    $tmpl = _qrt_load_template($id);

    $zstmt = db()->prepare(
        'SELECT zone_type, page, x_mm, y_mm, size_mm, custom_value, font_size
         FROM qr_template_zones WHERE template_id = ? ORDER BY page, id'
    );
    $zstmt->execute([$id]);
    $zones = $zstmt->fetchAll();

    $body     = body();
    $item_ids = isset($body['item_ids']) && is_array($body['item_ids'])
        ? array_map('intval', $body['item_ids'])
        : null;

    $items = _qrt_fetch_items($tmpl['item_filter'], $item_ids);

    if (empty($items)) json_error('No items match this template filter', 422);

    $tmpl_file = _qrt_storage_dir() . $tmpl['pdf_filename'];
    if (!file_exists($tmpl_file)) json_error('Template file missing', 500);

    $scheme   = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $base_url = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');

    $qr_lib = __DIR__ . '/../../../assets/vendor/phpqrcode/qrlib.php';
    if (file_exists($qr_lib)) require_once $qr_lib;
    $has_qrlib = class_exists('QRcode');

    require_once __DIR__ . '/../../../assets/vendor/fpdf/fpdf.php';
    require_once __DIR__ . '/../../../assets/vendor/fpdi/fpdi.php';

    $ext = strtolower(pathinfo($tmpl['pdf_filename'], PATHINFO_EXTENSION));

    $pdf = new FPDI();
    $pdf->SetAutoPageBreak(false);
    $pdf->SetMargins(0, 0, 0);

    // Load template dimensions once
    if ($ext === 'pdf') {
        $pdf->setSourceFile($tmpl_file);
        $tpl  = $pdf->importPage(1);
        $size = $pdf->getTemplateSize($tpl);
        $pw   = $size['w'];
        $ph   = $size['h'];
    } else {
        $img_info = getimagesize($tmpl_file);
        $pw = $img_info ? round($img_info[0] / 3.7795275591) : 210;
        $ph = $img_info ? round($img_info[1] / 3.7795275591) : 297;
        $tpl = null;
    }

    foreach ($items as $item) {
        $pdf->AddPage($pw > $ph ? 'L' : 'P', [$pw, $ph]);
        if ($tpl !== null) {
            $pdf->useTemplate($tpl, 0, 0, $pw, $ph);
        } else {
            $pdf->Image($tmpl_file, 0, 0, $pw, $ph);
        }

        foreach ($zones as $zone) {
            _qrt_draw_zone($pdf, $zone, $item, $base_url, $has_qrlib);
        }
    }

    $safe_name = preg_replace('/[^a-z0-9_-]/i', '_', $tmpl['name']);
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="' . $safe_name . '_labels.pdf"');
    header('Cache-Control: no-store');
    echo $pdf->Output('S');
    exit;
}

function _qrt_fetch_items(?string $filter, ?array $item_ids): array {
    $id_clause = '';
    $params    = [];

    if ($filter) {
        $params[] = $filter;
        if ($item_ids) {
            $ph        = implode(',', array_fill(0, count($item_ids), '?'));
            $id_clause = " AND i.id IN ($ph)";
            $params    = array_merge($params, $item_ids);
        }
        $stmt = db()->prepare(
            "SELECT i.id, i.qr_code, i.item_number, t.name AS type_name
             FROM equipment_items i
             JOIN equipment_types t ON t.id = i.equipment_type_id
             WHERE t.category = ? AND i.status != 'retired' $id_clause
             ORDER BY i.item_number"
        );
    } else {
        if ($item_ids) {
            $ph        = implode(',', array_fill(0, count($item_ids), '?'));
            $id_clause = "WHERE i.id IN ($ph) AND i.status != 'retired'";
            $params    = $item_ids;
        } else {
            $id_clause = "WHERE i.status != 'retired'";
        }
        $stmt = db()->prepare(
            "SELECT i.id, i.qr_code, i.item_number, t.name AS type_name
             FROM equipment_items i
             JOIN equipment_types t ON t.id = i.equipment_type_id
             $id_clause
             ORDER BY t.name, i.item_number"
        );
    }

    $stmt->execute($params);
    return $stmt->fetchAll();
}

function _qrt_draw_zone(FPDI $pdf, array $zone, array $item, string $base_url, bool $has_qrlib): void {
    $x    = (float)$zone['x_mm'];
    $y    = (float)$zone['y_mm'];
    $size = (float)$zone['size_mm'];
    $fs   = (int)$zone['font_size'];

    switch ($zone['zone_type']) {
        case 'qr_code':
            $qr_url = $base_url . '/scan?qr=' . rawurlencode($item['qr_code']);
            $tmp    = tempnam(sys_get_temp_dir(), 'qrt_') . '.png';
            if ($has_qrlib) {
                QRcode::png($qr_url, $tmp, QR_ECLEVEL_M, 10, 2);
            } else {
                $data = @file_get_contents(
                    'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' . urlencode($qr_url)
                );
                if ($data) file_put_contents($tmp, $data);
            }
            if (file_exists($tmp) && filesize($tmp) > 0) {
                $pdf->Image($tmp, $x, $y, $size, $size);
            }
            @unlink($tmp);
            break;

        case 'item_number':
            $line_h = $fs * 0.352778 * 1.5;
            $pdf->SetFont('Helvetica', 'B', $fs);
            $pdf->SetXY($x, $y);
            $pdf->Cell($size, $line_h, '#' . $item['item_number'], 0, 0, 'C');
            break;

        case 'item_name':
            $line_h = $fs * 0.352778 * 1.5;
            $pdf->SetFont('Helvetica', '', $fs);
            $pdf->SetXY($x, $y);
            $pdf->Cell($size, $line_h, $item['type_name'] . ' #' . $item['item_number'], 0, 0, 'C');
            break;

        case 'custom_text':
            $line_h = $fs * 0.352778 * 1.5;
            $pdf->SetFont('Helvetica', '', $fs);
            $pdf->SetXY($x, $y);
            $pdf->Cell($size, $line_h, $zone['custom_value'] ?? '', 0, 0, 'C');
            break;
    }
}
