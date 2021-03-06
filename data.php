<?php

require('3rdparty/WebAuthn/WebAuthn.php');
require('3rdparty/CBOR/CBOREncoder.php');
require('3rdparty/CBOR/Types/CBORByteString.php');

$authlifetime = 3600*24*61; // Max lifetime of auth tokens in seconds; this is reset whenever they are used

$dbfile = 'db/notes.sq3';
if (getcwd() != __DIR__) chdir(__DIR__);
if (!file_exists(dirname($dbfile))) fatalerr('Database directory ' . __DIR__ . '/' . dirname($dbfile) . " doesn't exist");
if (!is_writable(dirname($dbfile))) fatalerr('Database directory ' . __DIR__ . '/' . dirname($dbfile) . " is not writable for user " . posix_getpwuid(posix_geteuid())['name'] . ' with group ' . posix_getgrgid(posix_getegid())['name']);
if (!file_exists($dbfile)) fatalerr('Database file ' . __DIR__ . '/' . $dbfile . " doesn't exist");
if (!is_writable($dbfile)) fatalerr('Database file ' . __DIR__ . '/' . $dbfile . " is not writable for user " . posix_getpwuid(posix_geteuid())['name'] . ' with group ' . posix_getgrgid(posix_getegid())['name']);
$dbh = new PDO('sqlite:' . $dbfile);
if (query_setting('dbversion') < 11) upgrade_database();

if (php_sapi_name() == 'cli') handle_cli(); // Doesn't return
if ($_SERVER['REQUEST_METHOD'] == 'POST') {
  $input = file_get_contents('php://input');
  if (!($data = json_decode($input, true))) fatalerr('Invalid JSON data in request body');
  if (empty($data['req'])) fatalerr('No req specified in POST request');
}
else {
  if (empty($_GET['export']) || empty($_GET['note']) || !is_numeric($_GET['note'])) fatalerr('Invalid request');
  $data = [];
  $data['req'] = 'export';
  $data['mode'] = 'get' . $_GET['export'];
  $data['note'] = $_GET['note'];
}

$password = query_setting('password', '');
if (!empty($password)) {
  session_start();
  $instance = str_replace('/', '-', dirname($_SERVER['REQUEST_URI']));
  if (empty($_SESSION['login'.$instance])) {
    $webauthn = new \Davidearl\WebAuthn\WebAuthn($_SERVER['HTTP_HOST']);
    $keys = query_setting('webauthnkeys', '');
    if (!empty($keys)) $challenge = $webauthn->prepareForLogin($keys);
    else $challenge = '';
    if (!empty($data['password'])) {
      if (password_verify($data['password'], $password)) {
        $_SESSION['login'.$instance] = true;
        $_SESSION['since'.$instance] = time();
        if (isset($data['remember']) && $data['remember']) {
          $token = base64_encode(openssl_random_pseudo_bytes(32));
          $hash = hash('sha256', $token, FALSE);
          $expire = time()+$authlifetime;
          $id = sql_insert_id("INSERT INTO auth_token (hash, expires, device) VALUES (?, ?, ?)", [ $hash, $expire, getDevice() ]);
          if (!$id) fatalerr('Failed to add authentication token to database');
          $_SESSION['login'.$instance] = $id;
          setcookie('flownotes_remember', "$id:$token", $expire);
        }
      }
      else {
        usleep(rand(100000, 1500000));
        send_and_exit([ 'needpass' => 'invalid', 'modalerror' => 'Invalid password; please try again', 'challenge' => $challenge ]);
      }
    }
    elseif (!empty($_COOKIE['flownotes_remember'])) {
      list($id, $token) = explode(':', $_COOKIE['flownotes_remember']);
      if (empty($id) || empty($token) || !is_numeric($id) || ($id <= 0)) {
        send_and_exit([ 'needpass' => 'missing', 'modalerror' => 'Remember cookie invalid; please login with your password', 'challenge' => $challenge ]);
      }
      $hash = sql_single("SELECT hash FROM auth_token WHERE id = $id AND expires > strftime('%s', 'now')");
      if (empty($hash)) send_and_exit([ 'needpass' => 'missing', 'modalerror' => 'Remember cookie expired; please login with your password', 'challenge' => $challenge ]);
      if (hash_equals(hash('sha256', $token, FALSE), $hash)) {
        $_SESSION['login'.$instance] = $id;
        $_SESSION['since'.$instance] = time();
        $expire = time()+$authlifetime;
        sql_updateone("UPDATE auth_token SET expires = ?, device = ? WHERE id = $id", [ $expire, getDevice() ]);
        setcookie('flownotes_remember', "$id:$token", $expire);
      }
      else send_and_exit([ 'needpass' => 'missing', 'modalerror' => 'Please login with your password', 'challenge' => $challenge ]);
    }
    elseif (!empty($data['response']) && !empty($keys)) {
      if ($webauthn->authenticate($data['response'], $keys)) {
        $_SESSION['login'.$instance] = true;
        $_SESSION['since'.$instance] = time();
      }
      else send_and_exit([ 'needpass' => 'missing', 'modalerror' => 'Failed to login with U2F key', 'challenge' => $challenge ]);
    }
    else send_and_exit([ 'needpass' => 'missing', 'challenge' => $challenge ]);
  }
  else {
    $logout = query_setting('logout', 1500000000);
    if ($_SESSION['since'.$instance] < $logout) {
      unset($_SESSION['login'.$instance]);
      unset($_SESSION['since'.$instance]);
      setcookie('flownotes_remember', "", time()-3600);
      send_and_exit([ 'logout' => 'true']);
    }

    if (($data['req'] == 'logout') && !empty($data['session'])) {
      if ($data['session'] == 'all') {
        sql_single('DELETE FROM auth_token');
        store_setting('logout', time());
      }
      elseif (is_numeric($_SESSION['login'.$instance])) sql_single('DELETE FROM auth_token WHERE id = ' . $_SESSION['login'.$instance]);
      unset($_SESSION['login'.$instance]);
      unset($_SESSION['since'.$instance]);
      setcookie('flownotes_remember', "", time()-3600);
      send_and_exit([ 'logout' => 'true' ]);
    }
  }
  session_write_close();
}

if (!empty($data['activenote']) && is_numeric($data['activenote'])) $activenote = $data['activenote'];

$ret = [];

switch ($data['req']) {
  case 'init':
    if (!isset($activenote) || !sql_if('SELECT true FROM note WHERE id = ?', [ $activenote ])) {
      $activenote = sql_single('SELECT id FROM note ORDER BY modified DESC LIMIT 1');
      $ret['switchnote'] = $activenote;
    }
    $ret['notes'] = select_recent_notes(25);
    $ret['notes'] = select_pinned_notes(25) + $ret['notes'];
    $ret['notes'][$activenote] = select_note($activenote);
    $ret['recent'] = 25;
    $ret['password'] = !empty($password);
    if (!empty($data['term'])) {
      $results = search_notes($data['term']);
      $ret['notes'] = $results + $ret['notes'];
      $ret['searchresults'] = array_keys($results);
    }
    $ret['lastupdate'] = time();
    break;
  case 'recent':
    if (empty($data['offset'])) fatalerr('No offset in recent request');
    $ret['notes'] = select_recent_notes(25, $data['offset']);
    if (count($ret['notes']) < 25) $ret['recent'] = 'all';
    else $ret['recent'] = 25 + $data['offset'];
    break;
  case 'idle':
    if (query_setting('autoprune', 0) && (date('i') == '13')) $ret['log'] = prune_snapshots();
    sql_single("DELETE FROM auth_token WHERE expires < strftime('%s', 'now')");
    break;
  case 'update':
    $ret['notes'] = [];
    if (!empty($data['notes'])) {
      foreach ($data['notes'] as $id => $note) {
        if (isset($note['content'])) {
          if (!empty($data['lastupdate']) && sql_if("SELECT 1 FROM note WHERE id = ? AND modified > ? AND content != ?", [ $id, $data['lastupdate'], $note['content'] ])) {
            add_snapshot($id);
            $ret['alert'] = 'Note #' . $id . ' has been edited from another device. To avoid lost changes, that version has been saved as a snapshot.';
          }
          $ret['notes'] = update_note($id, $note) + $ret['notes'];
        }
        else $ret['notes'][$id]['pinned'] = update_note_meta($id, $note);
      }
    }
    if (!empty($data['term'])) {
      $results = search_notes($data['term']);
      $ret['notes'] = $results + $ret['notes'];
      $ret['searchresults'] = array_keys($results);
    }
    break;
  case 'activate':
    if (!isset($activenote)) fatalerr('Invalid activate request');
    if (empty($data['lazy']) || !$data['lazy']) {
      $ret['notes'] = [];
      $ret['notes'][$activenote] = select_note($activenote);
    }
    break;
  case 'search':
    if (empty($data['term'])) fatalerr('No term passed in req search');
    $ret['search'] = true;
    $ret['notes'] = search_notes($data['term']);
    $ret['searchresults'] = array_keys($ret['notes']);
    break;
  case 'add':
    $ret['notes'] = [];
    $activenote = add_note($data['content'] ?? '');
    $ret['switchnote'] = $activenote;
    $ret['notes'][$activenote] = select_note($activenote);
    break;
  case 'append':
    if (empty($data['id'])) fatalerr('No note id passed in req append');
    if (empty($data['content'])) fatalerr('No content passed in req append');
    $last = sql_single("SELECT substr(content, -1) FROM note WHERE id = ?", [ $data['id'] ]);
    if ($last != "\n") $data['content'] = "\n" . $data['content'];
    if (!sql_updateone("UPDATE note SET content = content || ?, changed = strftime('%s', 'now'), modified = strftime('%s', 'now') WHERE id = ?", [ $data['content'], $data['id'] ])) fatalerr('Failed to append content to note ' . $data['id']);
    $title = sql_single("SELECT title FROM note WHERE id = ?", [ $data['id'] ]);
    $ret['append'] = [];
    $ret['append']['id'] = $data['id'];
    $ret['append']['title'] = $title;
    store_setting('lastupdate', time());
    break;
  case 'delete':
    if (empty($data['id']) || !is_numeric($data['id'])) fatalerr('Invalid id passed in req delete');
    if (!empty($data['undelete'])) $change = 0;
    else $change = 1;

    if (!sql_updateone("UPDATE note SET deleted = $change, changed = strftime('%s', 'now') WHERE id = ?", [ $data['id'] ])) fatalerr("Failed to set delete to $change");
    $ret['notes'] = [];
    $ret['notes'][$data['id']] = [];
    $ret['notes'][$data['id']]['deleted'] = $change;
    break;
  case 'settings':
    if (empty($data['mode'])) fatalerr('Invalid settings request');
    switch ($data['mode']) {
      case 'save':
        if (isset($data['newpw'])) { // Setting/changing password
          if (!empty($password)) {
            if (empty($data['oldpw'])) send_and_exit([ 'modalerror' => 'Please enter your current password' ]);
            if (!password_verify($data['oldpw'], $password)) send_and_exit([ 'modalerror' => 'Invalid current password entered' ]);
          }
          if ($data['newpw'] === '') store_setting('password', '');
          else store_setting('password', password_hash($data['newpw'], PASSWORD_DEFAULT));
        }
        store_setting('autosnap', $data['autosnap']);
        store_setting('autoprune', $data['autoprune']);
        store_setting('snapafter', $data['snapafter']);
        store_setting('pruneafter', $data['pruneafter']);
        store_setting('prunedays', $data['prunedays']);
        store_setting('pruneweeks', $data['pruneweeks']);
        store_setting('prunemonths', $data['prunemonths']);
        if (preg_match('/^(\d+(, ?\d+)*|)$/', $data['shareappend'])) store_setting('shareappend', $data['shareappend']);
        send_and_exit([ 'settings' => 'stored' ]);
        break;
      case 'get':
        $webauthn = new \Davidearl\WebAuthn\WebAuthn($_SERVER['HTTP_HOST']);
        $keys = json_decode(query_setting('webauthnkeys', '[]'));
        foreach ($keys as $key) {
          $ret[] = dechex(crc32(implode('', $key->id)));
        }
        $settings = [];
        $settings['autosnap'] = query_setting('autosnap', 0);
        $settings['autoprune'] = query_setting('autoprune', 0);
        $settings['snapafter'] = query_setting('snapafter', 4);
        $settings['pruneafter'] = query_setting('pruneafter', 4);
        $settings['prunedays'] = query_setting('prunedays', 3);
        $settings['pruneweeks'] = query_setting('pruneweeks', 3);
        $settings['prunemonths'] = query_setting('prunemonths', 5);
        $settings['shareappend'] = query_setting('shareappend', '');
        send_and_exit([ 'webauthn' => 'list', 'keys' => $ret, 'settings' => $settings ]);
      case 'share':
        $settings = [];
        $settings['appendnotes'] = sql_rows_collect('SELECT id, title FROM note WHERE id IN (' . query_setting('shareappend') . ')');
        send_and_exit($settings);
    }
  case 'webauthn':
    if (empty($data['mode'])) fatalerr('Invalid webauthn request');
    $webauthn = new \Davidearl\WebAuthn\WebAuthn($_SERVER['HTTP_HOST']);
    switch ($data['mode']) {
      case 'prepare':
        send_and_exit([ 'webauthn' => 'register', 'challenge' => $webauthn->prepareChallengeForRegistration('FlowNotes', '1', true) ]);
        break;
      case 'register':
        if (empty($data['response'])) fatalerr('Invalid webauthn response');
        $keys = $webauthn->register($data['response'], query_setting('webauthnkeys', ''));
        if (empty($keys)) send_and_exit([ 'modalerror' => 'Failed to register U2F key on the server' ]);
        store_setting('webauthnkeys', $keys);
        send_and_exit([ 'webauthn' => 'registered' ]);
        break;
      default:
        fatalerr('Invalid webauthn mode');
    }
    break;
  case 'snapshot':
    if (empty($activenote)) fatalerr('Invalid snapshot request');
    switch ($data['mode']) {
      case 'list':
        $data['snapshots'] = true;
        break;
      case 'add':
        add_snapshot($activenote, $data['locked'] ?? 1);
        $data['snapshots'] = true;
        break;
      case 'del':
        if (empty($data['snapshot']) || !is_numeric($data['snapshot'])) fatalerr('Invalid snapshot request');
        del_snapshot($data['snapshot']);
        $data['snapshots'] = true;
        break;
      case 'pin':
        if (!isset($data['value']) || !is_numeric($data['value'])) fatalerr('Invalid snapshot request');
        sql_updateone('UPDATE snapshot SET locked = ? WHERE id = ?', [ $data['value'], $data['snapshot'] ]);
        break;
      default:
        fatalerr('Invalid request');
    }
    break;
  case 'export':
    require('Flowdown.php');
    switch ($data['mode']) {
      case 'gethtmlone':
        $note = select_note($data['note']);
        header('Content-type: text/html');
        header('Content-disposition: attachment; filename="' . $note['id'] . ' - ' . str_replace('/', '-', $note['title']) . '.html"');
        $head = file_get_contents('html-header.html');
        print str_replace('#title#', $note['title'], $head);
        $pd = new Flowdown('download');
        $pd->setBreaksEnabled(true)->setMarkupEscaped(true);
        print $pd->text($note['content']);
        readfile('html-footer.html');
        exit(0);
      case 'gettxtall':
        streamToZip();
        exit(0);
      case 'gethtmlall':
        streamToZip(true);
        exit(0);
      case 'pubhtmlone':
        if (empty($data['note']) || !is_numeric($data['note'])) fatalerr('Invalid pubhtmlone request');
        if (sql_if('SELECT 1 FROM publish WHERE note = ?', [ $data['note'] ])) fatalerr('Note #' . $data['note'] . ' is already published');
        $note = select_note($data['note']);
        $filename = query_setting('publicdir', 'public') . '/' . $note['id'] . '.html';
        $res = publish($note, $filename, 'html');
        if ($res != 'OK') fatalerr($res);
        if (!sql_updateone("INSERT INTO publish (note, type, file) VALUES (?, ?, ?)", [ $data['note'], 'html', $filename ])) fatalerr('Failed to create publish entry');
        sql_updateone("UPDATE note SET changed = strftime('%s', 'now') WHERE id = ?" [ $data['note'] ]);
        $note['published'] = [ [ 'type' => 'html', 'file' => $filename ] ];
        $ret['notes'][$note['id']] = $note;
        break;
      case 'pubfragone':
        if (empty($data['note']) || !is_numeric($data['note'])) fatalerr('Invalid pubhtmlone request');
        if (sql_if('SELECT 1 FROM publish WHERE note = ?', [ $data['note'] ])) fatalerr('Note #' . $data['note'] . ' is already published');
        $note = select_note($data['note']);
        $filename = query_setting('publicdir', 'public') . '/' . $note['id'] . '.html';
        $res = publish($note, $filename, 'frag');
        if ($res != 'OK') fatalerr($res);
        if (!sql_updateone("INSERT INTO publish (note, type, file) VALUES (?, ?, ?)", [ $data['note'], 'frag', $filename ])) fatalerr('Failed to create publish entry');
        sql_updateone("UPDATE note SET changed = strftime('%s', 'now') WHERE id = ?" [ $data['note'] ]);
        $note['published'] = [ [ 'type' => 'frag', 'file' => $filename ] ];
        $ret['notes'][$note['id']] = $note;
        break;
      case 'delone':
        if (empty($data['note']) || !is_numeric($data['note'])) fatalerr('Invalid delone request');
        if (empty($data['type'])) fatalerr('Invalid delone request');
        $note = select_note($data['note']);
        if (empty($note['published'])) fatalerr('Note #' . $data['note'] . ' is not published');
        if (!file_exists($note['published'][0]['file'])) $ret['log'] = "File '" . $note['published'][0]['file'] . "' doesn't exist; removing published status";
        elseif (!unlink($note['published'][0]['file'])) fatalerr('Failed to delete file ' . $note['published'][0]['file']);
        if (!sql_updateone("DELETE FROM publish WHERE note = ? AND type = ?", [ $data['note'], $data['type'] ])) fatalerr('Failed to delete publish entry');
        sql_updateone("UPDATE note SET changed = strftime('%s', 'now') WHERE id = ?" [ $data['note'] ]);
        $note['published'] = null;
        $ret['notes'][$note['id']] = $note;
        break;
    }
    break;
  case 'logout':
    send_and_exit([ 'modalerror' => 'Logout has no function without a configured password' ]);
  default:
    fatalerr('Invalid request');
}

if (!empty($data['lastupdate'])) {
  if ($data['lastupdate'] < query_setting('lastupdate', 0)) {
    if (empty($ret['notes'])) $ret['notes'] = select_notes_since($data['lastupdate']);
    else $ret['notes'] = $ret['notes'] + select_notes_since($data['lastupdate']);
  }
  if (!empty($activenote) && ($data['lastupdate'] < sql_single('SELECT changed FROM note WHERE id = ?', [ $activenote ]))) {
    $ret['notes'][$activenote] = select_note($activenote);
  }
  $ret['lastupdate'] = time();
}
if (!empty($data['snapshots']) && !empty($activenote)) {
  $ret['snapshotsfrom'] = $activenote;
  $ret['snapshots'] = select_note_snapshots($activenote);
}

send_and_exit($ret);

function query_setting($setting, $def = '') {
  global $dbh;
  if (!($res = $dbh->query("SELECT value FROM setting WHERE name = '$setting'"))) {
    fatalerr('Failed to read from database: ' . $dbh->errorInfo()[2]);
  }
  if (!($row = $res->fetch())) return $def;
  return $row[0];
}
function store_setting($setting, $value) {
  global $dbh;
  if (!($stmt = $dbh->prepare("INSERT OR REPLACE INTO setting (name, value) VALUES (?, ?)"))) {
    fatalerr('Failed to write to database: ' . $dbh->errorInfo()[2]);
  }
  if (!($stmt->execute([ $setting, $value ]))) {
    fatalerr('Failed to write to database: ' . $stmt->errorInfo()[2]);
  }
  return $value;
}

function find_title($content) {
  $res = preg_match_all("/([a-zA-Z0-9\u{00C0}-\u{024F}][a-zA-Z\u{00C0}-\u{024F}0-9 .\/\\&\'-]+[a-zA-Z\u{00C0}-\u{024F}0-9])/m", substr($content, 0, 100), $matches);
  if ($res) {
    if (($matches[0][0] == 'http') || ($matches[0][0] == 'https') && !empty($matches[0][1])) return $matches[0][1];
    else return $matches[0][0];
  }
  return '{no title}';
}

function add_note($content) {
  global $dbh;
  store_setting('lastupdate', time());
  if (!empty($content)) $title = find_title($content);
  else $title = null;
  if (!($stmt = $dbh->prepare("INSERT INTO note (title, content) VALUES (?, ?)"))) {
    error_log("add_note() query prepare failed: " . $dbh->errorInfo()[2]);
    return null;
  }
  if (!($stmt->execute([ $title, $content ]))) {
    error_log("add_note() query execute failed: " . $stmt->errorInfo()[2]);
    return [];
  }
  return $dbh->lastInsertId();
}
function select_note($id) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT note.*, group_concat(flink.target) AS flinks, group_concat(blink.source) AS blinks FROM note LEFT JOIN link AS flink ON flink.source = note.id LEFT JOIN link AS blink ON blink.target = note.id WHERE note.id = ?"))) {
    error_log("select_note() select prepare failed: " . $dbh->errorInfo()[2]);
    return [];
  }
  if (!($stmt->execute([ $id ]))) {
    error_log("select_note() select execute failed: " . $stmt->errorInfo()[2]);
    return [];
  }
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if (empty($row['id'])) {
    error_log("select_note() select for id $id returned no rows");
    return [];
  }
  if ($row['flinks']) $row['flinks'] = array_map('select_note_meta', array_values(array_unique(explode(',', $row['flinks']))));
  if ($row['blinks']) $row['blinks'] = array_map('select_note_meta', array_values(array_unique(explode(',', $row['blinks']))));
  $row['published'] = sql_rows_collect('SELECT type, file FROM publish WHERE note = ?', [ $id ]);
  return $row;
}
function select_note_meta($id) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, title, deleted FROM note WHERE id = ?"))) {
    error_log("select_recent_notes() prepare failed: " . $dbh->errorInfo()[2]);
    return [ 'id' => $id, 'title' => '{note not found}' ];
  }
  if (!($stmt->execute([ $id ]))) {
    error_log("select_recent_notes() execute failed: " . $stmt->errorInfo()[2]);
    return [ 'id' => $id, 'title' => '{note not found}' ];
  }
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$row) return [ 'id' => $id, 'title' => '{note not found}' ];
  return $row;
}
function select_recent_notes($count, $offset = 0) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, title FROM note WHERE deleted = 0 ORDER BY modified DESC LIMIT $count OFFSET $offset"))) {
    error_log("select_recent_notes() prepare failed: " . $dbh->errorInfo()[2]);
    return [];
  }
  if (!($stmt->execute())) {
    error_log("select_recent_notes() execute failed: " . $stmt->errorInfo()[2]);
    return [];
  }
  $notes = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $notes[$row['id']] = array_slice($row, 1);
  }
  return $notes;
}
function select_pinned_notes($count) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, title, pinned, deleted FROM note WHERE pinned > 0 ORDER BY pinned DESC LIMIT $count"))) {
    error_log("select_pinned_notes() prepare failed: " . $dbh->errorInfo()[2]);
    return [];
  }
  if (!($stmt->execute())) {
    error_log("select_pinned_notes() execute failed: " . $stmt->errorInfo()[2]);
    return [];
  }
  $notes = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $notes[$row['id']] = array_slice($row, 1);
  }
  return $notes;
}
function select_notes_since($lastupdate) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, title, pinned, deleted FROM note WHERE modified > ?"))) {
    error_log("select_notes_since() prepare failed: " . $dbh->errorInfo()[2]);
    return [];
  }
  if (!($stmt->execute([ $lastupdate ]))) {
    error_log("select_notes_since() execute failed: " . $stmt->errorInfo()[2]);
    return [];
  }
  $notes = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    if (empty($notes[$row['id']])) $notes[$row['id']] = array_slice($row, 1);
  }
  return $notes;
}
function select_note_snapshots($id) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, locked, title, content FROM snapshot WHERE note = ? ORDER BY modified DESC"))) {
    error_log("select_note_snapshots() prepare failed: " . $dbh->errorInfo()[2]);
    return [];
  }
  if (!($stmt->execute([ $id ]))) {
    error_log("select_note_snapshots() execute failed: " . $stmt->errorInfo()[2]);
    return [];
  }
  $snapshots = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $snapshots[] = $row;
  }
  return $snapshots;
}
function add_snapshot($id, $locked = 0) {
  global $dbh;
  if (!($stmt = $dbh->prepare("INSERT INTO snapshot (note, modified, locked, title, content) SELECT id, modified, $locked, title, content FROM note WHERE id = ?"))) {
    error_log("add_snapshot() prepare failed: " . $dbh->errorInfo()[2]);
    return;
  }
  if (!($stmt->execute([ $id ]))) {
    error_log("add_snapshot() execute failed: " . $stmt->errorInfo()[2]);
    return;
  }
  sql_updateone("UPDATE note SET snapped = strftime('%s', 'now'), changed = strftime('%s', 'now') WHERE id = ?", [ $id ]);
}
function del_snapshot($id) {
  global $dbh;
  if (!($stmt = $dbh->prepare("DELETE FROM snapshot WHERE id = ?"))) {
    error_log("del_snapshot() prepare failed: " . $dbh->errorInfo()[2]);
    return;
  }
  if (!($stmt->execute([ $id ]))) {
    error_log("del_snapshot() execute failed: " . $stmt->errorInfo()[2]);
    return;
  }
  sql_updateone("UPDATE note SET snapped = strftime('%s', 'now'), changed = strftime('%s', 'now') WHERE id = ?", [ $id ]);
}
function prune_snapshots() {
  $pruneafter = query_setting('pruneafter', 0);
  $prunedays = query_setting('prunedays', 0);
  $pruneweeks = query_setting('pruneweeks', 0);
  $prunemonths = query_setting('prunemonths', 0);
  $prune = $prunedays+$pruneweeks+$prunemonths;
  $now = microtime(true);
  sql_updatecount("UPDATE snapshot SET label = NULL");
  sql_foreach("SELECT note, count(*) FROM snapshot WHERE locked = 0 AND created < strftime('%s', 'now') - 86400*? GROUP BY note HAVING count(*) > 0",
    function($row) use ($pruneafter, $prunedays, $pruneweeks, $prunemonths) {
      $count = sql_updatecount("UPDATE snapshot SET todelete = 1 WHERE locked = 0 AND note = ? AND modified < strftime('%s', 'now') - 86400*?", [ $row[0], $pruneafter ]);
      // error_log('Note ' . $row[0] . " has $count automatic snapshots older than " . $pruneafter . ' days');
      $snaps = sql_column("SELECT modified FROM snapshot WHERE note = ? AND created < strftime('%s', 'now') - 86400*? ORDER BY 1 DESC", [ $row[0], $pruneafter ]);
      $keep = [ $prunedays, $pruneweeks, $prunemonths ];
      $ts = time() - 86400*$pruneafter;
      for ($i = 0; !empty($snaps[$i]);) {
        if ($keep[0]) { // Days
          $ts -= 86400;
          $keep[0]--;
          $label = 'Day ' . ($prunedays-$keep[0]);
        }
        elseif ($keep[1]) { // Weeks
          $ts -= 86400*7;
          $keep[1]--;
          $label = 'Week ' . ($pruneweeks-$keep[1]);
        }
        elseif ($keep[2]) { // Months
          $ts -= 86400*30;
          $keep[2]--;
          $label = 'Month ' . ($prunemonths-$keep[2]);
        }
        else {
          sql_updatecount("UPDATE snapshot SET todelete = 1, label = 'Too old' WHERE note = ? AND modified <= ? AND locked = 0", [ $row[0], $snaps[$i] ]);
          break;
        }
        while (!empty($snaps[$i+1]) && ($snaps[$i+1] > $ts)) $i++;
        sql_updatecount("UPDATE snapshot SET todelete = 0, label = '$label' WHERE note = ? AND modified = ?", [ $row[0], $snaps[$i] ]);
        if ($snaps[$i] > $ts) $i++;
      }
    },
    [ $pruneafter ]
  );
  $count = sql_updatecount("DELETE FROM snapshot WHERE todelete = 1");
  return 'Snapshot prune took ' . round(microtime(true)-$now, 2) . 's and deleted ' . $count . ' snapshots';
}

function search_notes($term) {
  global $dbh;

  if (substr($term, 0, 1) == '/') { // Regex search
    $dbh->sqliteCreateFunction('regexp', function($pattern, $data) {
      return (preg_match("/$pattern/i", $data));
    });
    if (!($stmt = $dbh->prepare("SELECT id, modified, title, deleted FROM note WHERE content REGEXP ?"))) {
      error_log("search_notes() prepare failed: " . $dbh->errorInfo()[2]);
      return [];
    }
    if (!($stmt->execute([ substr($term, 1) ]))) {
      error_log("search_notes() execute failed: " . $stmt->errorInfo()[2]);
      return [];
    }
  }
  else {
    if (!($stmt = $dbh->prepare("SELECT id, modified, title, deleted FROM note WHERE content LIKE ?"))) {
      error_log("search_notes() prepare failed: " . $dbh->errorInfo()[2]);
      return [];
    }
    if (!($stmt->execute([ '%' . preg_replace('/[^a-z0-9]/', '%', strtolower($term)) . '%' ]))) {
      error_log("search_notes() execute failed: " . $stmt->errorInfo()[2]);
      return [];
    }
  }

  $notes = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $notes[$row['id']] = array_slice($row, 1);
  }
  return $notes;
}
function update_note($id, $note) {
  global $dbh;
  if ($note['pinned']) {
    if ($note['pinned'] === true) {
      if (!($res = $dbh->query("SELECT MAX(pinned)+1 FROM note"))) {
        error_log("update_note() pinned select failed: " . $dbh->errorInfo()[2]);
        $pinned = 'NULL';
      }
      $pinned = $res->fetch(PDO::FETCH_NUM)[0];
    }
    else $pinned = $note['pinned'];
  }
  else $pinned = 0;

  $GLOBALS['extra_ids'] = [];
  if (!sql_if("SELECT 1 FROM note WHERE id = ? AND title = ?", [ $id, $note['title'] ])) { // Note changed title
    sql_foreach("SELECT * FROM link WHERE target = $id AND name IS NULL",
      function($row) use ($note) {
        $GLOBALS['extra_ids'][] = $row['source'];
        update_backlinks($row['source'], $row['target'], $note['title']);
      }
    );
  }
  if (query_setting('autosnap')) {
    $after = query_setting('snapafter', 0);
    $now = time();
    $ts = sql_single('SELECT snapped FROM note WHERE id = ?', [ $id ]);
    if ($now > $ts+$after*3600) {
      $content = sql_single('SELECT content FROM note WHERE id = ?', [ $id ]);
      if (!empty($content) && !sql_if('SELECT id FROM snapshot WHERE note = ? AND content = ?', [ $id, $content ])) { // No snapshots with this content
        add_snapshot($id);
      }
    }
  }
  if (!($stmt = $dbh->prepare("UPDATE note SET content = ?, title = ?, changed = strftime('%s', 'now'), modified = strftime('%s', 'now'), pinned = ?, cursor = ?, mode = ? WHERE id = ?"))) {
    error_log("update_note() update prepare failed: " . $dbh->errorInfo()[2]);
    return [];
  }

  if (empty($note['cursor'])) $cursor = null;
  elseif (is_array($note['cursor'])) $cursor = implode(',', $note['cursor']);
  else $cursor = $note['cursor'];

  if (!($stmt->execute([ $note['content'], $note['title'], $pinned, $cursor, $note['mode'] ?? 'edit', $id ]))) {
    $processUser = posix_getpwuid(posix_geteuid());
    error_log("update_note() update execute failed: " . $stmt->errorInfo()[2] . ' (userid: ' . json_encode($processUser) . ')');
    return [];
  }
  update_links($id, $note['content']);

  if (!($stmt = $dbh->query("SELECT note.modified, note.pinned, group_concat(flink.target) AS flinks, group_concat(blink.source) AS blinks FROM note LEFT JOIN link AS flink ON flink.source = note.id LEFT JOIN link AS blink ON blink.target = note.id WHERE note.id = $id"))) {
    error_log("update_note() select query failed: " . $dbh->errorInfo()[2]);
    return [];
  }
  if (!$row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    error_log("update_note() select query returned no results");
    return [];
  }
  if (!empty($row['flinks'])) $row['flinks'] = array_map('select_note_meta', array_values(array_unique(explode(',', $row['flinks']))));
  if (!empty($row['blinks'])) $row['blinks'] = array_map('select_note_meta', array_values(array_unique(explode(',', $row['blinks']))));

  $rows = [];
  $rows[$id] = $row;
  foreach ($GLOBALS['extra_ids'] as $id) {
    $rows[$id] = select_note($id);
  }

  $res = sql_rows('SELECT file, type FROM publish WHERE note = ?', [ $id ]);
  foreach ($res as $pub) {
    require_once('Flowdown.php');
    publish($note, $pub['file'], $pub['type']);
  }

  store_setting('lastupdate', time());
  return $rows;
}
function update_links($id, $content) {
  global $dbh;
  if (!($res = $dbh->query("DELETE FROM link WHERE source = $id"))) {
    error_log("update_links delete query failed: " . $dbh->errorInfo()[2]);
    return;
  }
  if (!preg_match_all('/\[([^]]+)\]\(#([0-9]+)\)/', $content, $matches)) return;
  for ($i = 0; isset($matches[1][$i]); $i++) {
    $text = $matches[1][$i];
    $link = $matches[2][$i];
    if (strpos($text, '=') === 0) $text = "NULL";
    else $text = "'$text'";
    if (!($res = $dbh->query("INSERT INTO link (source, target, name) VALUES ($id, $link, $text)"))) {
      error_log("update_links insert query failed: " . $dbh->errorInfo()[2]);
      return;
    }
  }
}
function update_backlinks($id, $target, $title) {
  $content = sql_single("SELECT content FROM note WHERE id = $id");
  $content = preg_replace("/\[=[^]]*\]\(#$target\)/", "[=$title](#$target)", $content);
  if (!sql_updateone("UPDATE note SET content = ?, changed = strftime('%s', 'now') WHERE id = $id", [ $content ])) fatalerr("Failed to update backlinks in note $id");
}
function update_note_meta($id, $note) {
  global $dbh;

  if (isset($note['pinned'])) {
    if ($note['pinned'] === true) {
      if (!($res = $dbh->query("SELECT MAX(pinned)+1 FROM note"))) {
        error_log("FlowNotes: update_note_meta() pinned select failed: " . $dbh->errorInfo()[2]);
        $pinned = NULL;
      }
      $pinned = $res->fetch(PDO::FETCH_NUM)[0];
      if (!is_numeric($pinned)) $pinned = 1;
    }
    else $pinned = $note['pinned'];
  }
  else $pinned = 0;

  if (isset($note['cursor'])) $cursor = implode(',', $note['cursor']);
  else $cursor = NULL;

  if (!($stmt = $dbh->prepare("UPDATE note SET pinned = ?, cursor = ?, mode = ?, changed = strftime('%s', 'now') WHERE id = ?"))) {
    error_log("FlowNotes: update_note_meta() update prepare failed: " . $dbh->errorInfo()[2]);
    return 0;
  }
  if (!($stmt->execute([ $pinned, $cursor, $note['mode'] ?? 'edit', $id ]))) {
    $processUser = posix_getpwuid(posix_geteuid());
    error_log("FlowNotes: update_note_meta() update execute failed: " . $stmt->errorInfo()[2] . ' (userid: ' . json_encode($processUser) . ')');
    return 0;
  }
  return $pinned;
}

function upgrade_database() {
  switch (query_setting('dbversion')) {
    case 2:
      sql_single('ALTER TABLE "note" ADD COLUMN cursor text');
    case 3:
      sql_single('CREATE TABLE IF NOT EXISTS "snapshot" (id integer primary key, note integer not null, modified integer not null, content text not null, title text, locked bool default false, FOREIGN KEY(note) REFERENCES note(id))');
    case 4:
      sql_single('CREATE TABLE "note_new" (id integer primary key, snapped integer default (strftime(\'%s\', \'now\')), modified integer default (strftime(\'%s\', \'now\')), content text, title text, pinned integer default 0, deleted boolean default 0, cursor text);');
      sql_single('INSERT INTO "note_new" (id, modified, content, title, pinned, deleted, cursor) SELECT id, modified, content, title, pinned, deleted, cursor FROM "note"');
      sql_single('DROP TABLE "note"');
      sql_single('ALTER TABLE "note_new" RENAME TO "note"');
    case 5:
      sql_single('ALTER TABLE "snapshot" ADD COLUMN todelete bool default 0');
      sql_single('ALTER TABLE "snapshot" ADD COLUMN label text');
    case 6:
      sql_single('ALTER TABLE "note" ADD COLUMN mode text default \'edit\'');
    case 7:
      sql_single('PRAGMA journal_mode=WAL');
      sql_single('CREATE TABLE "snapshot_new" (id integer primary key, note integer not null, created integer default (strftime(\'%s\', \'now\')), modified integer not null, title text, content text not null, locked bool default false, todelete bool default false, label text, FOREIGN KEY(note) REFERENCES note(id))');
      sql_single('INSERT INTO "snapshot_new" (id, note, created, modified, title, content, locked) SELECT id, note, modified, modified, title, content, locked FROM "snapshot"');
      sql_single('DROP TABLE "snapshot"');
      sql_single('ALTER TABLE "snapshot_new" RENAME to "snapshot"');
    case 8:
      sql_single('CREATE TABLE publish (id integer primary key, note integer not null, type text not null, file text not null)');
    case 9:
      sql_single('CREATE TABLE "note_new" (id integer primary key, snapped integer default (strftime(\'%s\', \'now\')), changed integer default (strftime(\'%s\', \'now\')), modified integer default (strftime(\'%s\', \'now\')), content text, title text, pinned integer default 0, deleted boolean default 0, cursor text, mode text default \'edit\')');
      sql_single('INSERT INTO "note_new" (id, snapped, changed, modified, content, title, pinned, deleted, cursor, mode) SELECT id, snapped, modified, modified, content, title, pinned, deleted, cursor, mode FROM "note"');
      sql_single('DROP TABLE "note"');
      sql_single('ALTER TABLE "note_new" RENAME TO "note"');
    case 10:
      sql_single('ALTER TABLE "auth_token" ADD COLUMN device text');
  }
  store_setting('dbversion', 11);
}

function handle_cli() {
  global $argv;
  $input = file_get_contents('php://stdin');
  if (empty($input)) {
    print "No input received\n";
    exit();
  }
  if (substr($input, 0, 5) == 'From ') {
    require('vendor/autoload.php');
    $msg = \ZBateson\MailMimeParser\Message::from($input);
    $input = '';
    if (!empty($msg->getHeaderValue('subject'))) $input .= $msg->getHeaderValue('subject') . "\n";
    if (!empty($msg->getTextContent())) $input .= $msg->getTextContent();
    else $input .= preg_replace([ '/<br ?\/?>/i', '/<\/?[^>]+>/' ], [ "\n", '' ], $msg->getHtmlContent());
  }
  switch ($argv[1] ?? null) {
    case 'create':
      add_note($input);
      break;
    case 'append':
      $id = intval($argv[2] ?? null);
      if (!$id) {
        print "Invalid id passed for action 'append'\n";
        exit();
      }
      $note = select_note($id);
      if (empty($note)) {
        print "Note with id $id not found\n";
        exit();
      }
      if (substr($note['content'], -1) != "\n") $note['content'] .= "\n\n";
      else $note['content'] .= "\n";
      $note['content'] .= $input;
      update_note($id, $note);
      break;
    default:
      print "Usage: data.php <action> [options]\n";
      print " Available actions:\n";
      print " - create: create a new note with the input as its content\n";
      print " - append <id>: append the input to the note with the specified id\n";
      print " - prepend <id>: prepend the input to the note with the specified id, but after the first line\n";
  }
  exit();
}

function getDevice() {
  $useragent = $_SERVER['HTTP_USER_AGENT'] ?? '';
  if (empty($useragent)) return 'Unknown';
  // It's impossible to get this right in all cases; just keep it simple and get it right in most cases.
  $regex = '/[^(]+\((?:Linux; |X11; )?([^ ;]+)[^)]+\)(?:.*(Edge|OPR)|.*?(Chrome|CriOS|FxiOS|Safari|Firefox)|.* ([^\/]+)\/)/';
  if (!preg_match($regex, $useragent, $matches)) return 'Unknown';
  $str = $matches[2] . $matches[3] . ' on ' . $matches[1];
  return str_replace([ 'CriOS', 'FxiOS', 'CrOS', 'OPR' ], [ 'Chrome', 'Firefox', 'ChromeOS', 'Opera' ], $str);
}

/* * * * * * * * * * * * * *
 *                         *
 *   SQL helper functions  *
 *                         *
 * * * * * * * * * * * * * */
function sql_rows($query, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_rows() prepare failed: " . $dbh->errorInfo()[2]);
    return false;
  }
  if (!($stmt->execute($params))) {
    error_log("sql_rows() execute failed: " . $stmt->errorInfo()[2]);
    return false;
  }
  return $stmt;
}
function sql_rows_collect($query, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_rows_collect() prepare failed: " . $dbh->errorInfo()[2]);
    return null;
  }
  if (!($stmt->execute($params))) {
    error_log("sql_rows_collect() execute failed: " . $stmt->errorInfo()[2]);
    return null;
  }
  $res = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) $res[] = $row;
  if (empty($res)) return null;
  return $res;
}
function sql_if($query, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_if() prepare failed: " . $dbh->errorInfo()[2]);
    return false;
  }
  if (!($stmt->execute($params))) {
    error_log("sql_if() execute failed: " . $stmt->errorInfo()[2]);
    return false;
  }
  if (!($row = $stmt->fetch(PDO::FETCH_NUM))) return false;
  if ($row[0]) return true;
  return false;
}
function sql_foreach($query, $function, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_foreach() prepare failed: " . $dbh->errorInfo()[2]);
    return false;
  }
  if (!($stmt->execute($params))) {
    error_log("sql_foreach() execute failed: " . $stmt->errorInfo()[2]);
    return false;
  }
  while ($row = $stmt->fetch()) $function($row);
}
function sql_single($query, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_single() prepare failed: " . $dbh->errorInfo()[2]);
    return "";
  }
  if (!($stmt->execute($params))) {
    error_log("sql_single() execute failed: " . $stmt->errorInfo()[2]);
    return "";
  }
  if (!($row = $stmt->fetch(PDO::FETCH_NUM))) return "";
  return $row[0];
}
function sql_column($query, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_column() prepare failed: " . $dbh->errorInfo()[2]);
    return [];
  }
  if (!($stmt->execute($params))) {
    error_log("sql_column() execute failed: " . $stmt->errorInfo()[2]);
    return [];
  }
  $ret = [];
  while ($row = $stmt->fetch(PDO::FETCH_NUM)) $ret[] = $row[0];
  return $ret;
}
function sql_insert_id($query, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_insert_id() prepare failed: " . $dbh->errorInfo()[2]);
    return false;
  }
  if (!($stmt->execute($params))) {
    error_log("sql_insert_id() execute failed: " . $stmt->errorInfo()[2]);
    return false;
  }
  if ($stmt->rowCount() != 1) return false;
  return $dbh->lastInsertId();
}
function sql_updateone($query, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_updateone() prepare failed: " . $dbh->errorInfo()[2]);
    return false;
  }
  if (!($stmt->execute($params))) {
    error_log("sql_updateone() execute failed: " . $stmt->errorInfo()[2]);
    return false;
  }
  if ($stmt->rowCount() != 1) return false;
  return true;
}
function sql_updatecount($query, $params = []) {
  global $dbh;
  if (!($stmt = $dbh->prepare($query))) {
    error_log("sql_updateone() prepare failed: " . $dbh->errorInfo()[2]);
    return 0;
  }
  if (!($stmt->execute($params))) {
    error_log("sql_updateone() execute failed: " . $stmt->errorInfo()[2]);
    return 0;
  }
  return $stmt->rowCount();
}

function send_and_exit($data) {
  header('Content-type: application/json');
  print json_encode($data);
  exit();
}
function fatalerr($msg) {
  header('Content-type: application/json');
  print json_encode([ 'error' => $msg ]);
  exit(1);
}

function publish($note, $file, $type) {
  if (!($fh = fopen($file, 'w'))) return "Failed to create file; is the exports folder '" . query_setting('publicdir', 'public') . "' writable?";
  if ($type == 'html') {
    $head = file_get_contents('html-header.html');
    if (!fwrite($fh, str_replace('#title#', $note['title'], $head))) return 'Failed to write export file';
  }
  $pd = new Flowdown('publish');
  $pd->setBreaksEnabled(true)->setMarkupEscaped(true);
  if (!fwrite($fh, $pd->text($note['content']))) return 'Failed to write export file';
  if ($type == 'html') {
    if (!fwrite($fh, file_get_contents('html-footer.html'))) return 'Failed to write export file';
  }
  return 'OK';
}

function streamToZip($html = false) { // Adapted from the ZipExtension class from PhpMyAdmin - GPL 2+ license
  header('Content-type: application/zip');
  header('Content-disposition: attachment; filename="FlowNotes ' . date('Y-m-d') . '.zip"');
  $datasec = []; // Array to store compressed data
  $ctrl_dir = []; // Central directory
  $old_offset = 0; // Last offset position
  $eof_ctrl_dir = "\x50\x4b\x05\x06\x00\x00\x00\x00"; // End of central directory record

  if ($html) {
    $pd = new Flowdown('download');
    $pd->setBreaksEnabled(true)->setMarkupEscaped(true);
    $head = file_get_contents('html-header.html');
    $foot = file_get_contents('html-footer.html');
  }

  $stmt = sql_rows('SELECT id, title, content, modified FROM note WHERE deleted = 0 ORDER BY id');

  while ($note = $stmt->fetch(PDO::FETCH_ASSOC)) {
    if ($html) {
      $filename = $note['id'] . ' - ' . str_replace('/', '-', $note['title']) . '.html';
      $content = str_replace('#title#', $note['title'], $head);
      $content .= $pd->text($note['content']);
      $content .= $foot;
    }
    else {
      $filename = $note['id'] . ' - ' . str_replace('/', '-', $note['title']) . '.txt';
      $content = $note['content'];
    }
    $timearray = getdate($note['modified']);
    $time = (($timearray['year'] - 1980) << 25)
      | ($timearray['mon'] << 21)
      | ($timearray['mday'] << 16)
      | ($timearray['hours'] << 11)
      | ($timearray['minutes'] << 5)
      | ($timearray['seconds'] >> 1);

    $hexdtime = pack('V', $time);
    $unc_len = strlen($content);
    $crc = crc32($content);
    $zdata = gzcompress($content);
    $zdata = substr(substr($zdata, 0, strlen($zdata) - 4), 2); // fix crc bug
    $c_len = strlen($zdata);
    $fr = "\x50\x4b\x03\x04"
      . "\x14\x00"        // ver needed to extract
      . "\x00\x08"        // gen purpose bit flag
      . "\x08\x00"        // compression method
      . $hexdtime         // last mod time and date
      // "local file header" segment
      . pack('V', $crc)              // crc32
      . pack('V', $c_len)            // compressed filesize
      . pack('V', $unc_len)          // uncompressed filesize
      . pack('v', strlen($filename)) // length of filename
      . pack('v', 0)                 // extra field length
      . $filename
      // "file data" segment
      . $zdata;
    print $fr;

    // now add to central directory record
    $cdrec = "\x50\x4b\x01\x02"
      . "\x00\x00"                    // version made by
      . "\x14\x00"                    // version needed to extract
      . "\x00\x08"                    // gen purpose bit flag
      . "\x08\x00"                    // compression method
      . $hexdtime                     // last mod time & date
      . pack('V', $crc)               // crc32
      . pack('V', $c_len)             // compressed filesize
      . pack('V', $unc_len)           // uncompressed filesize
      . pack('v', strlen($filename))  // length of filename
      . pack('v', 0)                  // extra field length
      . pack('v', 0)                  // file comment length
      . pack('v', 0)                  // disk number start
      . pack('v', 0)                  // internal file attributes
      . pack('V', 32)                 // external file attributes
                                      // - 'archive' bit set
      . pack('V', $old_offset)        // relative offset of local header
      . $filename;                    // filename
    $old_offset += strlen($fr);
    // optional extra field, file comment goes here
    // save to central directory
    $ctrl_dir[] = $cdrec;
  }

  /* Build string to return */
  $temp_ctrldir = implode('', $ctrl_dir);
  print $temp_ctrldir .
    $eof_ctrl_dir .
    pack('v', count($ctrl_dir)) . //total #of entries "on this disk"
    pack('v', count($ctrl_dir)) . //total #of entries overall
    pack('V', strlen($temp_ctrldir)) . //size of central dir
    pack('V', $old_offset) . //offset to start of central dir
    "\x00\x00";                         //.zip file comment length
}
