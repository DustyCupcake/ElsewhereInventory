<?php
declare(strict_types=1);

function handle_camps(): void {
    require_method('GET');
    $user = require_auth();

    // Production: all barrios (or filter by dept). Dept: own dept's barrios.
    if (has_permission('view_inventory')) {
        $where  = isset($_GET['dept_id']) ? 'WHERE dept_id = ?' : '';
        $params = isset($_GET['dept_id']) ? [(int)$_GET['dept_id']] : [];
    } else {
        $placeholders = implode(',', array_fill(0, count($user['dept_ids']), '?'));
        $where        = $placeholders ? "WHERE dept_id IN ($placeholders)" : 'WHERE 1=0';
        $params       = $user['dept_ids'];
    }

    $stmt = db()->prepare(
        "SELECT id, name, arrival_status FROM barrios $where ORDER BY sort_order, name"
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    json_ok(['camps' => $rows]);
}
