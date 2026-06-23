<?php
declare(strict_types=1);

function handle_reset(): void {
    require_method('POST');
    require_permission('manage_equipment');
    require_permission('manage_barrios');
    verify_csrf();

    $b = body();

    $release_barrio      = !empty($b['release_barrio']);
    $release_all         = !empty($b['release_all']);
    $reset_barrio_status = !empty($b['reset_barrio_status']);
    $clear_distributions = !empty($b['clear_distributions']);
    $clear_transactions  = !empty($b['clear_transactions']);

    if (!$release_barrio && !$release_all && !$reset_barrio_status && !$clear_distributions && !$clear_transactions) {
        json_error('Select at least one category to reset', 400);
    }

    $db = db();
    $db->beginTransaction();
    try {
        $result = [];

        if ($release_all) {
            $stmt = $db->prepare(
                'UPDATE equipment_items
                 SET status = \'available\', current_dept_id = NULL, dept_label = NULL,
                     current_barrio_id = NULL, current_artist_id = NULL, current_person_id = NULL
                 WHERE status != \'retired\''
            );
            $stmt->execute();
            $result['items_released'] = $stmt->rowCount();
        } elseif ($release_barrio) {
            $stmt = $db->prepare(
                'UPDATE equipment_items
                 SET current_barrio_id = NULL, current_artist_id = NULL, current_person_id = NULL
                 WHERE current_barrio_id IS NOT NULL
                    OR current_artist_id IS NOT NULL
                    OR current_person_id IS NOT NULL'
            );
            $stmt->execute();
            $result['items_released'] = $stmt->rowCount();
        }

        if ($reset_barrio_status) {
            $stmt = $db->prepare(
                'UPDATE barrios
                 SET arrival_status   = \'expected\',
                     arrived_at       = NULL,
                     arrived_by       = NULL,
                     arrived_by_name  = NULL,
                     orientation_done = 0,
                     departed_at      = NULL,
                     departed_by      = NULL,
                     departed_by_name = NULL'
            );
            $stmt->execute();
            $result['barrios_reset'] = $stmt->rowCount();
        }

        if ($clear_distributions) {
            $stmt = $db->prepare('UPDATE barrio_entitlements SET distributed = 0');
            $stmt->execute();
            $result['entitlements_cleared'] = $stmt->rowCount();

            $stmt2 = $db->prepare('DELETE FROM distribution_events');
            $stmt2->execute();
            $result['distribution_events_deleted'] = $stmt2->rowCount();
        }

        if ($clear_transactions) {
            $stmt = $db->prepare('DELETE FROM transactions');
            $stmt->execute();
            $result['transactions_deleted'] = $stmt->rowCount();
        }

        $db->commit();
        json_ok(['success' => true, 'result' => $result]);
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}
