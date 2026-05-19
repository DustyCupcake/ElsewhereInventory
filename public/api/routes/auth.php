<?php
declare(strict_types=1);

function handle_login(): void {
    require_method('POST');
    start_session();

    $b        = body();
    $username = trim($b['username'] ?? '');
    $password = $b['password'] ?? '';

    if ($username === '' || $password === '') {
        json_error('Username and password required');
    }

    $stmt = db()->prepare(
        'SELECT id, username, display_name, password_hash, role, language, is_active
         FROM users WHERE username = ?'
    );
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !$user['is_active'] || !password_verify($password, $user['password_hash'])) {
        json_error('Invalid credentials', 401);
    }

    db()->prepare('UPDATE users SET last_login = NOW() WHERE id = ?')->execute([$user['id']]);

    // Load dept memberships with sub_entity info
    $dept_stmt = db()->prepare(
        'SELECT udr.dept_id, udr.role, d.sub_entity, d.name AS dept_name
         FROM user_dept_roles udr
         JOIN departments d ON d.id = udr.dept_id
         WHERE udr.user_id = ?'
    );
    $dept_stmt->execute([$user['id']]);
    $memberships = $dept_stmt->fetchAll();

    $dept_ids         = array_column($memberships, 'dept_id');
    $dept_roles       = [];
    $dept_sub_entities = [];
    foreach ($memberships as $m) {
        $dept_roles[(int)$m['dept_id']]       = $m['role'];
        $dept_sub_entities[(int)$m['dept_id']] = $m['sub_entity'];
    }

    // Load per-user permission overrides
    $perm_stmt = db()->prepare('SELECT permission, granted FROM user_permissions WHERE user_id = ?');
    $perm_stmt->execute([$user['id']]);
    $perm_overrides = $perm_stmt->fetchAll();

    $permissions = compute_permissions($user['role'], $memberships, $perm_overrides);

    $qr_token = ensure_user_qr_token((int)$user['id']);
    $csrf     = bin2hex(random_bytes(32));
    $_SESSION = [
        'user_id'           => (int)$user['id'],
        'username'          => $user['username'],
        'display_name'      => $user['display_name'],
        'role'              => $user['role'],
        'dept_ids'          => array_map('intval', $dept_ids),
        'dept_roles'        => $dept_roles,
        'dept_sub_entities' => $dept_sub_entities,
        'permissions'       => $permissions,
        'language'          => $user['language'] ?? 'en',
        'is_shift'          => false,
        'shift_id'          => null,
        'shift_name'        => null,
        'qr_token'          => $qr_token,
        'csrf_token'        => $csrf,
    ];

    json_ok([
        'id'                => (int)$user['id'],
        'username'          => $user['username'],
        'display_name'      => $user['display_name'],
        'role'              => $user['role'],
        'dept_ids'          => $_SESSION['dept_ids'],
        'dept_roles'        => $_SESSION['dept_roles'],
        'dept_sub_entities' => $dept_sub_entities,
        'permissions'       => $permissions,
        'language'          => $_SESSION['language'],
        'is_shift'          => false,
        'qr_token'          => $qr_token,
        'csrf_token'        => $csrf,
    ]);
}

function handle_logout(): void {
    require_method('POST');
    start_session();
    session_destroy();
    json_ok(['success' => true]);
}

function handle_me(): void {
    require_method('GET');
    $user = require_auth();
    json_ok(array_merge($user, ['csrf_token' => csrf_token()]));
}

function handle_csrf(): void {
    require_method('GET');
    start_session();
    json_ok(['csrf_token' => csrf_token()]);
}

function handle_register(): void {
    require_method('POST');

    $b            = body();
    $invite_token = trim($b['invite_token'] ?? '');
    $username     = trim($b['username'] ?? '');
    $display_name = trim($b['display_name'] ?? '');
    $password     = $b['password'] ?? '';
    $confirm      = $b['confirm_password'] ?? '';

    if ($invite_token === '') {
        json_error('An invite link is required to register', 403);
    }

    $tok_stmt = db()->prepare(
        'SELECT * FROM invite_tokens
         WHERE token = ? AND use_count < 1 AND expires_at > NOW()'
    );
    $tok_stmt->execute([$invite_token]);
    $tok = $tok_stmt->fetch();

    if (!$tok) {
        json_error('Invite link is invalid or has expired', 403);
    }

    if ($username === '' || $display_name === '' || $password === '') {
        json_error('All fields are required', 400);
    }
    if (strlen($password) < 8) {
        json_error('Password must be at least 8 characters', 400);
    }
    if ($password !== $confirm) {
        json_error('Passwords do not match', 400);
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $pdo  = db();
    $pdo->beginTransaction();
    try {
        $pdo->prepare(
            'INSERT INTO users (username, display_name, password_hash, role, is_active)
             VALUES (?, ?, ?, ?, 1)'
        )->execute([$username, $display_name, $hash, $tok['role']]);

        $new_user_id = (int)$pdo->lastInsertId();

        // Add dept membership if role is dept-level
        if ($tok['dept_id'] && in_array($tok['role'], ['dept_admin', 'dept_staff'], true)) {
            $pdo->prepare(
                'INSERT INTO user_dept_roles (user_id, dept_id, role) VALUES (?, ?, ?)'
            )->execute([$new_user_id, $tok['dept_id'], $tok['role']]);
        }

        $pdo->prepare(
            'UPDATE invite_tokens SET use_count = use_count + 1 WHERE id = ?'
        )->execute([$tok['id']]);

        $pdo->commit();
    } catch (PDOException $e) {
        $pdo->rollBack();
        if (str_contains($e->getMessage(), 'Duplicate') || str_contains($e->getMessage(), '1062')) {
            json_error('Username already taken', 409);
        }
        throw $e;
    }

    json_ok(['message' => 'Account created. You can now log in.'], 201);
}

function handle_invite_info(): void {
    require_method('GET');
    $token = trim($_GET['token'] ?? '');

    if ($token === '') {
        json_error('token required', 400);
    }

    $stmt = db()->prepare(
        'SELECT it.role, it.expires_at, it.use_count,
                d.name AS dept_name
         FROM invite_tokens it
         LEFT JOIN departments d ON d.id = it.dept_id
         WHERE it.token = ?'
    );
    $stmt->execute([$token]);
    $tok = $stmt->fetch();

    if (!$tok) {
        json_ok(['valid' => false, 'reason' => 'not_found']);
        return;
    }
    if ($tok['use_count'] >= 1) {
        json_ok(['valid' => false, 'reason' => 'used']);
        return;
    }
    if (strtotime($tok['expires_at']) < time()) {
        json_ok(['valid' => false, 'reason' => 'expired']);
        return;
    }

    json_ok([
        'valid'     => true,
        'role'      => $tok['role'],
        'dept_name' => $tok['dept_name'],
    ]);
}

function handle_shift_info(): void {
    require_method('GET');
    $token = trim($_GET['token'] ?? '');

    if ($token === '') {
        json_error('token required', 400);
    }

    $stmt = db()->prepare(
        'SELECT st.*, s.name AS shift_name, s.active_from, s.active_until, s.permissions,
                d.name AS dept_name
         FROM shift_tokens st
         JOIN shifts s ON s.id = st.shift_id
         LEFT JOIN departments d ON d.id = s.dept_id
         WHERE st.token = ?'
    );
    $stmt->execute([$token]);
    $tok = $stmt->fetch();

    if (!$tok) {
        json_ok(['valid' => false, 'reason' => 'not_found']);
        return;
    }

    $now = time();
    if (strtotime($tok['active_from']) > $now) {
        json_ok(['valid' => false, 'reason' => 'not_started', 'active_from' => $tok['active_from']]);
        return;
    }
    if (strtotime($tok['active_until']) < $now) {
        json_ok(['valid' => false, 'reason' => 'ended', 'active_until' => $tok['active_until']]);
        return;
    }

    $perms = json_decode($tok['permissions'], true) ?: [];

    json_ok([
        'valid'               => true,
        'shift_name'          => $tok['shift_name'],
        'dept_name'           => $tok['dept_name'],
        'active_from'         => $tok['active_from'],
        'active_until'        => $tok['active_until'],
        'permissions_summary' => $perms,
    ]);
}

function handle_shift_login(): void {
    require_method('POST');
    start_session();

    $b              = body();
    $token          = trim($b['token'] ?? '');
    $volunteer_name = trim($b['volunteer_name'] ?? '');

    if ($token === '' || $volunteer_name === '') {
        json_error('token and volunteer_name required', 400);
    }

    $stmt = db()->prepare(
        'SELECT st.id, st.shift_id,
                s.name AS shift_name, s.permissions, s.dept_id,
                s.active_from, s.active_until
         FROM shift_tokens st
         JOIN shifts s ON s.id = st.shift_id
         WHERE st.token = ?'
    );
    $stmt->execute([$token]);
    $tok = $stmt->fetch();

    if (!$tok) json_error('Invalid shift code', 401);

    $now = time();
    if (strtotime($tok['active_from']) > $now) json_error('This shift has not started yet', 403);
    if (strtotime($tok['active_until']) < $now) json_error('This shift has ended', 403);

    // Record use (allow re-use within shift window — volunteer may close/reopen browser)
    db()->prepare('UPDATE shift_tokens SET used_at = NOW() WHERE id = ?')->execute([$tok['id']]);

    $perms = json_decode($tok['permissions'], true) ?: [];
    $csrf  = bin2hex(random_bytes(32));

    session_regenerate_id(true);
    $_SESSION = [
        'user_id'      => null,
        'username'     => null,
        'display_name' => $volunteer_name . ' (' . $tok['shift_name'] . ')',
        'role'         => null,
        'dept_ids'     => $tok['dept_id'] ? [(int)$tok['dept_id']] : [],
        'dept_roles'   => [],
        'permissions'  => $perms,
        'language'     => 'en',
        'is_shift'     => true,
        'shift_id'     => (int)$tok['shift_id'],
        'shift_name'   => $tok['shift_name'],
        'csrf_token'   => $csrf,
    ];

    json_ok([
        'display_name' => $_SESSION['display_name'],
        'permissions'  => $perms,
        'is_shift'     => true,
        'shift_name'   => $tok['shift_name'],
        'csrf_token'   => $csrf,
    ]);
}

function handle_change_password(): void {
    require_method('POST');
    $user = require_auth();
    verify_csrf();

    if ($user['is_shift']) {
        json_error('Cannot change password in shift session', 403);
    }

    $b           = body();
    $current     = $b['current_password'] ?? '';
    $new_pass    = $b['new_password'] ?? '';
    $confirm     = $b['confirm_password'] ?? '';

    if ($current === '' || $new_pass === '' || $confirm === '') {
        json_error('All fields are required', 400);
    }
    if (strlen($new_pass) < 8) {
        json_error('New password must be at least 8 characters', 400);
    }
    if ($new_pass !== $confirm) {
        json_error('Passwords do not match', 400);
    }

    $stmt = db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$user['id']]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($current, $row['password_hash'])) {
        json_error('Current password is incorrect', 403);
    }

    $hash = password_hash($new_pass, PASSWORD_BCRYPT);
    db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        ->execute([$hash, $user['id']]);

    json_ok(['success' => true]);
}

function handle_language(): void {
    require_method('POST');
    $user = require_auth();
    verify_csrf();

    if ($user['is_shift']) {
        json_error('Cannot change language in shift session', 403);
    }

    $b    = body();
    $lang = trim($b['lang'] ?? '');

    if (!preg_match('/^[a-z]{2,5}$/', $lang)) {
        json_error('Invalid language code');
    }

    db()->prepare('UPDATE users SET language = ? WHERE id = ?')->execute([$lang, $user['id']]);
    $_SESSION['language'] = $lang;
    unset($_SESSION['_auth_cache']);

    json_ok(['success' => true, 'language' => $lang]);
}
