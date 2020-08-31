<?php

require('3rdparty/WebAuthn/WebAuthn.php');
require('3rdparty/CBOR/CBOREncoder.php');
require('3rdparty/CBOR/Types/CBORByteString.php');

header('Content-type: application/json');

$input = file_get_contents("php://input");
if ($_SERVER['REQUEST_METHOD'] != 'POST') fatalerr('Invalid request method');
if (!($data = json_decode($input, true))) fatalerr('Invalid JSON data in request body');
if (empty($data['req'])) fatalerr('No req specified in POST request');

$dbh = new PDO('sqlite:db/notes.sq3');
if (query_setting('dbversion') < 6) upgrade_database();

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
          $expire = time()+60*60*24*30;
          $id = sql_insert_id("INSERT INTO auth_token (hash, expires) VALUES ('$hash', $expire)");
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
        sql_single("DELETE FROM auth_token WHERE expires < strftime('%s', 'now')");
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

if (!empty($data['activenote']) && is_numeric($data['activenote'])) $activenote = store_setting('activenote', $data['activenote']);
else $activenote = query_setting('activenote', '1');

$ret = [];

switch ($data['req']) {
  case 'init':
    prune_snapshots();
    if (empty($data['activenote'])) $ret['switchnote'] = $activenote;
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
    if (!empty($data['snapshots'])) {
      $ret['note'] = $activenote;
      $ret['snapshots'] = select_note_snapshots($activenote);
    }
    break;
  case 'recent':
    if (empty($data['offset'])) fatalerr('No offset in recent request');
    $ret['notes'] = select_recent_notes(25, $data['offset']);
    if (count($ret['notes']) < 25) $ret['recent'] = 'all';
    else $ret['recent'] = 25 + $data['offset'];
    break;
  case 'idle':
    $ret['activenote'] = $activenote;
    break;
  case 'update':
    $ret['notes'] = [];
    if (!empty($data['notes'])) {
      foreach ($data['notes'] as $id => $note) {
        if (isset($note['content'])) {
          if (!empty($data['lastupdate']) && sql_if("SELECT 1 FROM note WHERE id = ? AND modified > ? AND content != ?", [ $id, $data['lastupdate'], $note['content'] ])) {
            fatalerr('Note has been edited from another location; save your edits and reload the window to continue');
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
    $ret['notes'] = [];
    $ret['notes'][$activenote] = select_note($activenote);
    if (!empty($data['lazy']) && $data['lazy'] && !empty($data['modified']) && ($data['modified'] == $ret['notes'][$activenote]['modified'])) unset($ret['notes']);
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
  case 'delete':
    if (empty($data['id']) || !is_numeric($data['id'])) fatalerr('Invalid id passed in req delete');
    if (!empty($data['undelete'])) $change = 0;
    else $change = 1;

    if (!sql_updateone("UPDATE note SET deleted = $change WHERE id = ?", [ $data['id'] ])) fatalerr("Failed to set delete to $change");
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
        $settings['snapafter'] = query_setting('snapafter', '');
        $settings['pruneafter'] = query_setting('pruneafter', '');
        $settings['prunedays'] = query_setting('prunedays', '');
        $settings['pruneweeks'] = query_setting('pruneweeks', '');
        $settings['prunemonths'] = query_setting('prunemonths', '');
        send_and_exit([ 'webauthn' => 'list', 'keys' => $ret, 'settings' => $settings ]);
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
    switch ($data['mode']) {
      case 'list':
        if (empty($data['note']) || !is_numeric($data['note'])) fatalerr('Invalid snapshot request');
        $ret['note'] = $data['note'];
        $ret['snapshots'] = select_note_snapshots($data['note']);
        break;
      case 'add':
        if (empty($data['note']) || !is_numeric($data['note'])) fatalerr('Invalid snapshot request');
        add_snapshot($data['note'], 1);
        $ret['note'] = $data['note'];
        $ret['snapshots'] = select_note_snapshots($data['note']);
        break;
      case 'del':
        if (empty($data['note']) || !is_numeric($data['note'])) fatalerr('Invalid snapshot request');
        if (empty($data['snapshot']) || !is_numeric($data['snapshot'])) fatalerr('Invalid snapshot request');
        del_snapshot($data['snapshot']);
        $ret['note'] = $data['note'];
        $ret['snapshots'] = select_note_snapshots($data['note']);
        break;
      case 'pin':
        if (empty($data['snapshot']) || !is_numeric($data['snapshot'])) fatalerr('Invalid snapshot request');
        if (!isset($data['value']) || !is_numeric($data['value'])) fatalerr('Invalid snapshot request');
        sql_updateone('UPDATE snapshot SET locked = ? WHERE id = ?', [ $data['value'], $data['snapshot'] ]);
        break;
      default:
        fatalerr('Invalid request');
    }
    break;
  case 'logout':
    send_and_exit([ 'modalerror' => 'Logout has no function without a configured password' ]);
  default:
    fatalerr('Invalid request');
}

if (!empty($data['lastupdate']) && ($data['lastupdate'] < query_setting('lastupdate', 0))) {
  if (empty($ret['notes'])) $ret['notes'] = select_notes_since($data['lastupdate']);
  else $ret['notes'] = select_notes_since($data['lastupdate']) + $ret['notes'];
}
send_and_exit($ret);

function query_setting($setting, $def = '') {
  global $dbh;
  if (!($res = $dbh->query("SELECT value FROM setting WHERE name = '$setting'"))) {
    $err = $dbh->errorInfo();
    error_log("query_setting() failed: " . $err[2]);
    return $def;
  }
  if (!($row = $res->fetch())) return $def;
  return $row[0];
}
function store_setting($setting, $value) {
  global $dbh;
  if (!($stmt = $dbh->prepare("INSERT OR REPLACE INTO setting (name, value) VALUES (?, ?)"))) {
    $err = $dbh->errorInfo();
    error_log("store_setting() prepare failed: " . $err[2]);
    return null;
  }
  if (!($stmt->execute([ $setting, $value ]))) {
    $err = $stmt->errorInfo();
    error_log("store_setting() execute failed: " . $err[2]);
    fatalerr('Failed to write to database: ' . $err[2]);
  }
  return $value;
}

function add_note($content) {
  global $dbh;
  if (!($stmt = $dbh->prepare("INSERT INTO note (content) VALUES (?)"))) {
    $err = $dbh->errorInfo();
    error_log("add_note() query prepare failed: " . $err[2]);
    return null;
  }
  if (!($stmt->execute([ $content ]))) {
    $err = $stmt->errorInfo();
    error_log("add_note() query execute failed: " . $err[2]);
    return [];
  }
  return $dbh->lastInsertId();
}
function select_note($id) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT note.*, group_concat(flink.target) AS flinks, group_concat(blink.source) AS blinks FROM note LEFT JOIN link AS flink ON flink.source = note.id LEFT JOIN link AS blink ON blink.target = note.id WHERE note.id = ?"))) {
    $err = $dbh->errorInfo();
    error_log("select_note() select prepare failed: " . $err[2]);
    return [];
  }
  if (!($stmt->execute([ $id ]))) {
    $err = $stmt->errorInfo();
    error_log("select_note() select execute failed: " . $err[2]);
    return [];
  }
  $row = $stmt->fetch(PDO::FETCH_ASSOC);
  if (empty($row['id'])) {
    error_log("select_note() select for id $id returned no rows");
    return [];
  }
  if ($row['flinks']) $row['flinks'] = array_map('intval', array_unique(explode(',', $row['flinks'])));
  if ($row['blinks']) $row['blinks'] = array_map('intval', array_unique(explode(',', $row['blinks'])));
  return $row;
}
function select_recent_notes($count, $offset = 0) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, title FROM note WHERE deleted = 0 ORDER BY modified DESC LIMIT $count OFFSET $offset"))) {
    $err = $dbh->errorInfo();
    error_log("select_recent_notes() prepare failed: " . $err[2]);
    return [];
  }
  if (!($stmt->execute())) {
    $err = $stmt->errorInfo();
    error_log("select_recent_notes() execute failed: " . $err[2]);
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
    $err = $dbh->errorInfo();
    error_log("select_pinned_notes() prepare failed: " . $err[2]);
    return [];
  }
  if (!($stmt->execute())) {
    $err = $stmt->errorInfo();
    error_log("select_pinned_notes() execute failed: " . $err[2]);
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
  global $activenote;
  if (!($stmt = $dbh->prepare("SELECT id, modified, title, deleted FROM note WHERE modified > ?"))) {
    $err = $dbh->errorInfo();
    error_log("select_notes_since() prepare failed: " . $err[2]);
    return [];
  }
  if (!($stmt->execute([ $lastupdate ]))) {
    $err = $stmt->errorInfo();
    error_log("select_notes_since() execute failed: " . $err[2]);
    return [];
  }
  $notes = [];
  while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    $notes[$row['id']] = array_slice($row, 1);
  }
  if (!empty($notes[$activenote])) $notes[$activenote] = select_note($activenote);
  return $notes;
}
function select_note_snapshots($id) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, locked, title, content FROM snapshot WHERE note = ? ORDER BY modified"))) {
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
  sql_updateone("UPDATE note SET snapped = strftime('%s', 'now') WHERE id = ?", [ $id ]);
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
}
function prune_snapshots() {
  $pruneafter = query_setting('pruneafter', 0);
  $prunedays = query_setting('prunedays', 0);
  $pruneweeks = query_setting('pruneweeks', 0);
  $prunemonths = query_setting('prunemonths', 0);
  $prune = $prunedays+$pruneweeks+$prunemonths;
  // $now = microtime(true);
  sql_updatecount("UPDATE snapshot SET label = NULL");
  sql_foreach("SELECT note, count(*) FROM snapshot WHERE locked = 0 AND modified < strftime('%s', 'now') - 86400*? GROUP BY note HAVING count(*) > 0",
    function($row) use ($pruneafter, $prunedays, $pruneweeks, $prunemonths) {
      $count = sql_updatecount("UPDATE snapshot SET todelete = 1 WHERE locked = 0 AND note = ? AND modified < strftime('%s', 'now') - 86400*?", [ $row[0], $pruneafter ]);
      error_log('Note ' . $row[0] . " has $count automatic snapshots older than " . $pruneafter . ' days');
      $snaps = sql_column("SELECT modified FROM snapshot WHERE note = ? AND modified < strftime('%s', 'now') - 86400*? ORDER BY 1 DESC", [ $row[0], $pruneafter ]);
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
  // error_log('Prune took ' . (microtime(true)-$now) . ' ms');
  $count = sql_updatecount("DELETE FROM snapshot WHERE todelete = 1");
  error_log("Deleted $count snapshots");
}

function search_notes($term) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, title, deleted FROM note WHERE content LIKE ?"))) {
    $err = $dbh->errorInfo();
    error_log("search_notes() prepare failed: " . $err[2]);
    return [];
  }
  if (!($stmt->execute([ '%' . preg_replace('/[^a-z0-9]/', '%', strtolower($term)) . '%' ]))) {
    $err = $stmt->errorInfo();
    error_log("search_notes() execute failed: " . $err[2]);
    return [];
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
        $err = $dbh->errorInfo();
        error_log("update_note() pinned select failed: " . $err[2]);
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
      if (!sql_if('SELECT id FROM snapshot WHERE note = ? AND content = ?', [ $id, $content ])) { // No snapshots with this content
        add_snapshot($id);
      }
    }
  }
  if (!($stmt = $dbh->prepare("UPDATE note SET content = ?, title = ?, modified = strftime('%s', 'now'), pinned = ?, cursor = ? WHERE id = ?"))) {
    error_log("update_note() update prepare failed: " . $dbh->errorInfo()[2]);
    return;
  }

  if (empty($note['cursor'])) $cursor = null;
  else $cursor = implode(',', $note['cursor']);

  if (!($stmt->execute([ $note['content'], $note['title'], $pinned, $cursor, $id ]))) {
    $processUser = posix_getpwuid(posix_geteuid());
    error_log("update_note() update execute failed: " . $stmt->errorInfo()[2] . ' (userid: ' . json_encode($processUser) . ')');
    return;
  }
  update_links($id, $note['content']);

  if (!($stmt = $dbh->query("SELECT modified, pinned FROM note WHERE id = $id"))) {
    $err = $dbh->errorInfo();
    error_log("update_note() select query failed: " . $err[2]);
    return [];
  }
  $rows = [];
  if (!$row = $stmt->fetch(PDO::FETCH_ASSOC)) {
    error_log("update_note() select query returned no results");
    return [];
  }
  $rows[$id] = $row;
  foreach ($GLOBALS['extra_ids'] as $id) {
    $rows[$id] = select_note($id);
  }
  if ($row['modified'] > query_setting('lastupdate', 0)) store_setting('lastupdate', $row['modified']);
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
  if (!sql_updateone("UPDATE note SET content = ? WHERE id = $id", [ $content ])) fatalerr("Failed to update backlinks in note $id");
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

  if (!($stmt = $dbh->prepare("UPDATE note SET pinned = ?, cursor = ? WHERE id = ?"))) {
    error_log("FlowNotes: update_note_meta() update prepare failed: " . $dbh->errorInfo()[2]);
    return 0;
  }
  if (!($stmt->execute([ $pinned, $cursor, $id ]))) {
    $err = $stmt->errorInfo();
    $processUser = posix_getpwuid(posix_geteuid());
    error_log("FlowNotes: update_note_meta() update execute failed: " . $err[2] . ' (userid: ' . json_encode($processUser) . ')');
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
      sql_single('INSERT INTO "note_new" (id, modified, content, title, pinned, deleted, cursor) SELECT * FROM "note"');
      sql_single('DROP TABLE "note"');
      sql_single('ALTER TABLE "note_new" RENAME TO "note"');
    case 5:
      sql_single('ALTER TABLE "snapshot" ADD COLUMN todelete bool default 0');
      sql_single('ALTER TABLE "snapshot" ADD COLUMN label text');
  }
  store_setting('dbversion', 6);
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
  print json_encode($data);
//  error_log('OUT: ' . json_encode($data));
  exit();
}
function fatalerr($msg) {
  print json_encode([ 'error' => $msg ]);
  exit(1);
}
