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

    $stmt = db()->prepare(
        'SELECT id, name, item_filter, layout_mode,
                tag_width_mm, tag_height_mm, page_cols, page_rows,
                margin_mm, gap_mm, page_width_mm, page_height_mm,
                pdf_filename, created_at
         FROM qr_templates ORDER BY name'
    );
    $stmt->execute();
    json_ok(['templates' => $stmt->fetchAll()]);
}

// POST /admin/qr-templates  (multipart/form-data)
function handle_qrt_create(): void {
    require_method('POST');
    require_permission('manage_equipment');
    verify_csrf();

    $name        = trim($_POST['name'] ?? '');
    $item_filter = trim($_POST['item_filter'] ?? '') ?: null;
    $layout_mode = $_POST['layout_mode'] ?? 'page';
    if (!in_array($layout_mode, ['page', 'grid'], true)) $layout_mode = 'page';
    if (!$name) json_error('Name is required', 422);

    // Grid-specific fields
    $tag_w   = $layout_mode === 'grid' ? (float)($_POST['tag_width_mm']  ?? 0) : null;
    $tag_h   = $layout_mode === 'grid' ? (float)($_POST['tag_height_mm'] ?? 0) : null;
    $cols    = max(1, (int)($_POST['page_cols'] ?? 1));
    $rows    = max(1, (int)($_POST['page_rows'] ?? 1));
    $margin  = max(0.0, (float)($_POST['margin_mm'] ?? 10));
    $gap     = max(0.0, (float)($_POST['gap_mm']    ?? 5));
    $pg_w    = !empty($_POST['page_width_mm'])  ? (float)$_POST['page_width_mm']  : null;
    $pg_h    = !empty($_POST['page_height_mm']) ? (float)$_POST['page_height_mm'] : null;

    if ($layout_mode === 'grid' && ($tag_w <= 0 || $tag_h <= 0)) {
        json_error('Tag width and height are required for grid mode', 422);
    }

    // File upload — required for page mode, optional for grid
    $filename = null;
    $has_file = !empty($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK;
    if (!$has_file && $layout_mode === 'page') {
        json_error('A template file is required for full-page mode', 422);
    }
    if ($has_file) {
        $file    = $_FILES['file'];
        $mime    = mime_content_type($file['tmp_name']);
        $allowed = ['application/pdf', 'image/png', 'image/jpeg'];
        if (!in_array($mime, $allowed, true)) {
            json_error('Only PDF, PNG and JPEG files are accepted', 422);
        }
        $ext      = match($mime) { 'application/pdf' => 'pdf', 'image/png' => 'png', default => 'jpg' };
        $filename = bin2hex(random_bytes(16)) . '.' . $ext;
        $dest     = _qrt_storage_dir() . $filename;
        if (!is_dir(_qrt_storage_dir())) mkdir(_qrt_storage_dir(), 0755, true);
        if (!move_uploaded_file($file['tmp_name'], $dest)) json_error('Failed to save file', 500);
    }

    $stmt = db()->prepare(
        'INSERT INTO qr_templates
            (name, pdf_filename, item_filter, layout_mode,
             tag_width_mm, tag_height_mm, page_cols, page_rows,
             margin_mm, gap_mm, page_width_mm, page_height_mm)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([$name, $filename, $item_filter, $layout_mode,
                    $tag_w, $tag_h, $cols, $rows, $margin, $gap, $pg_w, $pg_h]);
    $id = (int)db()->lastInsertId();

    json_ok(['id' => $id, 'name' => $name, 'layout_mode' => $layout_mode]);
}

// DELETE /admin/qr-templates/:id
function handle_qrt_delete(): void {
    require_method('DELETE');
    require_permission('manage_equipment');
    verify_csrf();

    $id   = (int)($_GET['id'] ?? 0);
    $tmpl = _qrt_load_template($id);

    if ($tmpl['pdf_filename']) {
        $file = _qrt_storage_dir() . $tmpl['pdf_filename'];
        if (file_exists($file)) unlink($file);
    }

    $stmt = db()->prepare('DELETE FROM qr_templates WHERE id = ?');
    $stmt->execute([$id]);

    json_ok(['deleted' => true]);
}

// POST /admin/qr-templates/:id/replace-file  — swap background without touching zones
function handle_qrt_replace_file(): void {
    require_method('POST');
    require_permission('manage_equipment');
    verify_csrf();

    $id   = (int)($_GET['id'] ?? 0);
    $tmpl = _qrt_load_template($id);

    if (empty($_FILES['file']['tmp_name'])) json_error('No file uploaded', 422);

    $file    = $_FILES['file'];
    $allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    $mime    = mime_content_type($file['tmp_name']);
    if (!in_array($mime, $allowed, true)) json_error('File must be PDF, PNG, or JPEG', 422);

    $ext      = ['application/pdf' => 'pdf', 'image/png' => 'png', 'image/jpeg' => 'jpg'][$mime];
    $filename = bin2hex(random_bytes(16)) . '.' . $ext;
    if (!move_uploaded_file($file['tmp_name'], _qrt_storage_dir() . $filename)) {
        json_error('Failed to save file', 500);
    }

    if ($tmpl['pdf_filename']) {
        $old = _qrt_storage_dir() . $tmpl['pdf_filename'];
        if (file_exists($old)) @unlink($old);
    }

    $stmt = db()->prepare('UPDATE qr_templates SET pdf_filename = ? WHERE id = ?');
    $stmt->execute([$filename, $id]);

    json_ok(['pdf_filename' => $filename]);
}

// POST /admin/qr-templates/:id/duplicate  — copy template + zones + file
function handle_qrt_duplicate(): void {
    require_method('POST');
    require_permission('manage_equipment');
    verify_csrf();

    $id   = (int)($_GET['id'] ?? 0);
    $tmpl = _qrt_load_template($id);

    $new_filename = null;
    if ($tmpl['pdf_filename']) {
        $src = _qrt_storage_dir() . $tmpl['pdf_filename'];
        if (file_exists($src)) {
            $ext          = pathinfo($tmpl['pdf_filename'], PATHINFO_EXTENSION);
            $new_filename = bin2hex(random_bytes(16)) . '.' . $ext;
            copy($src, _qrt_storage_dir() . $new_filename);
        }
    }

    $ins = db()->prepare(
        'INSERT INTO qr_templates
             (name, pdf_filename, item_filter, layout_mode,
              tag_width_mm, tag_height_mm, page_cols, page_rows,
              margin_mm, gap_mm, page_width_mm, page_height_mm)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $ins->execute([
        $tmpl['name'] . ' Copy',
        $new_filename,
        $tmpl['item_filter'],
        $tmpl['layout_mode'],
        $tmpl['tag_width_mm'],
        $tmpl['tag_height_mm'],
        $tmpl['page_cols'],
        $tmpl['page_rows'],
        $tmpl['margin_mm'],
        $tmpl['gap_mm'],
        $tmpl['page_width_mm'],
        $tmpl['page_height_mm'],
    ]);
    $new_id = (int)db()->lastInsertId();

    $zstmt = db()->prepare(
        'SELECT zone_type, page, x_mm, y_mm, size_mm, custom_value, font_size
         FROM qr_template_zones WHERE template_id = ? ORDER BY page, id'
    );
    $zstmt->execute([$id]);
    $zone_ins = db()->prepare(
        'INSERT INTO qr_template_zones
             (template_id, zone_type, page, x_mm, y_mm, size_mm, custom_value, font_size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    foreach ($zstmt->fetchAll() as $z) {
        $zone_ins->execute([
            $new_id, $z['zone_type'], $z['page'],
            $z['x_mm'], $z['y_mm'], $z['size_mm'],
            $z['custom_value'], $z['font_size'],
        ]);
    }

    json_ok(['id' => $new_id, 'name' => $tmpl['name'] . ' Copy'], 201);
}

// GET /admin/qr-templates/:id/preview  — serves the raw PDF/image file
function handle_qrt_preview(): void {
    require_method('GET');
    require_permission('manage_equipment');

    $id   = (int)($_GET['id'] ?? 0);
    $tmpl = _qrt_load_template($id);

    if (!$tmpl['pdf_filename']) json_error('No background file for this template', 404);

    $file = _qrt_storage_dir() . $tmpl['pdf_filename'];
    if (!file_exists($file)) json_error('File not found', 404);

    $ext  = strtolower(pathinfo($tmpl['pdf_filename'], PATHINFO_EXTENSION));
    $mime = match($ext) { 'pdf' => 'application/pdf', 'png' => 'image/png', default => 'image/jpeg' };

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
    _qrt_load_template($id);

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

    $body        = body();
    $zones       = $body['zones'] ?? [];
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

    $scheme   = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $base_url = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');

    $qr_lib = __DIR__ . '/../../../assets/vendor/phpqrcode/qrlib.php';
    if (file_exists($qr_lib)) require_once $qr_lib;
    $has_qrlib = class_exists('QRcode');

    require_once __DIR__ . '/../../../assets/vendor/fpdf/fpdf.php';
    if (!defined('FPDF_VERSION')) define('FPDF_VERSION', FPDF::VERSION);
    require_once __DIR__ . '/../../../assets/vendor/fpdi/fpdi.php';

    $tmpl_file = $tmpl['pdf_filename'] ? _qrt_storage_dir() . $tmpl['pdf_filename'] : null;
    $ext       = $tmpl_file ? strtolower(pathinfo($tmpl_file, PATHINFO_EXTENSION)) : null;

    // Buffer any PHP notices/warnings so they don't corrupt the PDF or JSON response
    ob_start();
    try {
        $pdf = new FPDI();
        $pdf->SetAutoPageBreak(false);
        $pdf->SetMargins(0, 0, 0);

        if ($tmpl['layout_mode'] === 'grid') {
            _qrt_generate_grid($pdf, $tmpl, $zones, $items, $tmpl_file, $ext, $base_url, $has_qrlib);
        } else {
            _qrt_generate_page($pdf, $tmpl, $zones, $items, $tmpl_file, $ext, $base_url, $has_qrlib);
        }

        $output    = $pdf->Output('S');
        $safe_name = preg_replace('/[^a-z0-9_-]/i', '_', $tmpl['name']);
        ob_end_clean();
        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="' . $safe_name . '_labels.pdf"');
        header('Cache-Control: no-store');
        echo $output;
        exit;
    } catch (Throwable $e) {
        ob_end_clean();
        json_error('PDF generation failed: ' . $e->getMessage(), 500);
    }
}

// ─── Generation modes ─────────────────────────────────────────────────────────

function _qrt_generate_page(FPDI $pdf, array $tmpl, array $zones, array $items,
                             ?string $tmpl_file, ?string $ext,
                             string $base_url, bool $has_qrlib): void
{
    if ($tmpl_file && !file_exists($tmpl_file)) json_error('Template file missing', 500);

    if ($tmpl_file && $ext === 'pdf') {
        $pdf->setSourceFile($tmpl_file);
        $bg_tpl = $pdf->importPage(1);
        $size   = $pdf->getTemplateSize($bg_tpl);
        $pw = $size['w'];
        $ph = $size['h'];
    } elseif ($tmpl_file) {
        $info = getimagesize($tmpl_file);
        $pw   = $info ? round($info[0] / 3.7795275591) : 210;
        $ph   = $info ? round($info[1] / 3.7795275591) : 297;
        $bg_tpl = null;
    } else {
        $pw = 210; $ph = 297; $bg_tpl = null;
    }

    foreach ($items as $item) {
        $pdf->AddPage($pw > $ph ? 'L' : 'P', [$pw, $ph]);
        if (isset($bg_tpl)) {
            $pdf->useTemplate($bg_tpl, 0, 0, $pw, $ph);
        } elseif ($tmpl_file) {
            $pdf->Image($tmpl_file, 0, 0, $pw, $ph);
        }
        foreach ($zones as $zone) {
            _qrt_draw_zone($pdf, $zone, $item, $base_url, $has_qrlib, 0, 0);
        }
    }
}

function _qrt_generate_grid(FPDI $pdf, array $tmpl, array $zones, array $items,
                             ?string $tmpl_file, ?string $ext,
                             string $base_url, bool $has_qrlib): void
{
    $tag_w  = (float)$tmpl['tag_width_mm'];
    $tag_h  = (float)$tmpl['tag_height_mm'];
    $cols   = max(1, (int)$tmpl['page_cols']);
    $rows   = max(1, (int)$tmpl['page_rows']);
    $margin = (float)$tmpl['margin_mm'];
    $gap    = (float)$tmpl['gap_mm'];
    $pw     = (float)($tmpl['page_width_mm']  ?: 210);
    $ph     = (float)($tmpl['page_height_mm'] ?: 297);

    $items_per_page = $cols * $rows;
    $total_pages    = (int)ceil(count($items) / $items_per_page);
    $orientation    = $pw > $ph ? 'L' : 'P';

    // Load tag background once
    $bg_tpl = null;
    if ($tmpl_file && file_exists($tmpl_file)) {
        if ($ext === 'pdf') {
            $pdf->setSourceFile($tmpl_file);
            $bg_tpl = $pdf->importPage(1);
        }
        // image files are placed per-tag via Image()
    }

    for ($p = 0; $p < $total_pages; $p++) {
        $pdf->AddPage($orientation, [$pw, $ph]);

        for ($r = 0; $r < $rows; $r++) {
            for ($c = 0; $c < $cols; $c++) {
                $idx = $p * $items_per_page + $r * $cols + $c;
                if ($idx >= count($items)) break 2;

                $x_off = $margin + $c * ($tag_w + $gap);
                $y_off = $margin + $r * ($tag_h + $gap);

                // Draw tag background
                if ($bg_tpl !== null) {
                    $pdf->useTemplate($bg_tpl, $x_off, $y_off, $tag_w, $tag_h);
                } elseif ($tmpl_file && file_exists($tmpl_file)) {
                    $pdf->Image($tmpl_file, $x_off, $y_off, $tag_w, $tag_h);
                }

                foreach ($zones as $zone) {
                    _qrt_draw_zone($pdf, $zone, $items[$idx], $base_url, $has_qrlib, $x_off, $y_off);
                }
            }
        }
    }
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function _qrt_fetch_items(?string $filter, ?array $item_ids): array {
    $params = [];

    if ($filter) {
        // Match on category slug OR equipment type name (case-insensitive)
        $params[] = $filter;
        $params[] = $filter;
        $id_clause = '';
        if ($item_ids) {
            $ph        = implode(',', array_fill(0, count($item_ids), '?'));
            $id_clause = " AND i.id IN ($ph)";
            $params    = array_merge($params, $item_ids);
        }
        $stmt = db()->prepare(
            "SELECT i.id, i.qr_code, i.item_number, t.name AS type_name
             FROM equipment_items i
             JOIN equipment_types t ON t.id = i.equipment_type_id
             WHERE (t.category = ? OR LOWER(t.name) = LOWER(?)) AND i.status != 'retired' $id_clause
             ORDER BY i.item_number"
        );
    } else {
        $id_clause = "WHERE i.status != 'retired'";
        if ($item_ids) {
            $ph        = implode(',', array_fill(0, count($item_ids), '?'));
            $id_clause = "WHERE i.id IN ($ph) AND i.status != 'retired'";
            $params    = $item_ids;
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

function _qrt_draw_zone(FPDI $pdf, array $zone, array $item, string $base_url,
                         bool $has_qrlib, float $x_off, float $y_off): void
{
    $x    = (float)$zone['x_mm'] + $x_off;
    $y    = (float)$zone['y_mm'] + $y_off;
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
