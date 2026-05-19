<?php
declare(strict_types=1);

// Public lookup of a storage location by QR code.
// Returns basic info for any caller; richer detail when authenticated.
function handle_location_lookup(): void {
    require_method('GET');

    $qr = trim($_GET['qr'] ?? '');
    if ($qr === '') json_error('qr required', 400);

    $stmt = db()->prepare(
        'SELECT id, name, description, qr_code FROM storage_locations WHERE qr_code = ?'
    );
    $stmt->execute([$qr]);
    $loc = $stmt->fetch();

    if (!$loc) json_error('Location not found', 404);

    $result = [
        'type'        => 'storage_location',
        'id'          => (int)$loc['id'],
        'name'        => $loc['name'],
        'description' => $loc['description'],
        'qr_code'     => $loc['qr_code'],
    ];

    // If authenticated, also return what's currently stored here
    start_session();
    $authed = !empty($_SESSION['user_id']) || !empty($_SESSION['is_shift']);
    if ($authed) {
        $items_stmt = db()->prepare(
            'SELECT CONCAT(t.name, " #", i.item_number) AS name, i.status
             FROM equipment_items i
             JOIN equipment_types t ON t.id = i.equipment_type_id
             WHERE i.current_location_id = ?
             ORDER BY t.name, i.item_number'
        );
        $items_stmt->execute([(int)$loc['id']]);
        $result['items_here'] = $items_stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    json_ok($result);
}
