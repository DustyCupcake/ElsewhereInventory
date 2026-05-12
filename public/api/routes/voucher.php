<?php
declare(strict_types=1);

function handle_voucher_status(): void {
    require_method('GET');

    $qr = trim($_GET['qr'] ?? '');
    if ($qr === '') {
        json_ok(['voucher_status' => 'not_found', 'confirmed_at' => null]);
        return;
    }

    $stmt = db()->prepare(
        'SELECT i.id, i.status, t.secure_qr
         FROM equipment_items i
         JOIN equipment_types t ON t.id = i.equipment_type_id
         WHERE i.qr_code = ?'
    );
    $stmt->execute([$qr]);
    $item = $stmt->fetch();

    if (!$item || !$item['secure_qr']) {
        json_ok(['voucher_status' => 'not_found', 'confirmed_at' => null]);
        return;
    }

    // Check for fill_confirmed transaction
    $conf = db()->prepare(
        'SELECT occurred_at FROM transactions
         WHERE item_id = ? AND type = "fill_confirmed"
         ORDER BY occurred_at DESC LIMIT 1'
    );
    $conf->execute([$item['id']]);
    $confirmed = $conf->fetch();

    if ($confirmed) {
        json_ok(['voucher_status' => 'confirmed', 'confirmed_at' => $confirmed['occurred_at']]);
        return;
    }

    $status_map = [
        'used'        => 'validated',
        'activated'   => 'activated',
        'checked-out' => 'pending',
    ];

    $voucher_status = $status_map[$item['status']] ?? 'unknown';
    json_ok(['voucher_status' => $voucher_status, 'confirmed_at' => null]);
}
