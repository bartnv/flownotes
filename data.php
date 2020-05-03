<?

require('3rdparty/WebAuthn/WebAuthn.php');
require('3rdparty/CBOR/CBOREncoder.php');
require('3rdparty/CBOR/Types/CBORByteString.php');

header('Content-type: application/json');

$input = file_get_contents("php://input");
if ($_SERVER['REQUEST_METHOD'] != 'POST') fatalerr('Invalid request method');
if (!($data = json_decode($input, true))) fatalerr('Invalid JSON data in request body');
if (empty($data['req'])) fatalerr('No req specified in POST request');

$dbh = new PDO('sqlite:db/notes.sq3');

$password = query_setting('password', '');
if (!empty($password)) {
  session_start();
  $instance = str_replace('/', '-', dirname($_SERVER['REQUEST_URI']));
  if (empty($_SESSION['login'.$instance])) {
    $webauthn = new \Davidearl\WebAuthn\WebAuthn($_SERVER['HTTP_HOST']);
    $keys = query_setting('webauthnkeys', '');
    if (!empty($keys)) $challenge = $webauthn->prepareForLogin($keys);
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
    $ret['notes'] = search_notes($data['term']);
    $ret['searchresults'] = array_keys($ret['notes']);
    break;
  case 'add':
    $ret['notes'] = [];
    $activenote = add_note();
    $ret['switchnote'] = $activenote;
    $ret['notes'][$activenote] = select_note($activenote);
    break;
  case 'delete':
    if (empty($data['id']) || !is_numeric($data['id'])) fatalerr('Invalid id passed in req delete');
    if (!empty($data['undelete'])) $change = 0;
    else $change = 1;

    if (!sql_updateone("UPDATE note SET deleted = $change, modified = strftime('%s', 'now') WHERE id = ?", [ $data['id'] ])) fatalerr("Failed to set delete to $change");
    $ret['notes'] = [];
    $ret['notes'][$data['id']] = [];
    $ret['notes'][$data['id']]['deleted'] = $change;
    break;
  case 'settings':
    if (isset($data['newpw'])) { // Setting/changing password
      if (!empty($password)) {
        if (empty($data['oldpw'])) send_and_exit([ 'modalerror' => 'Please enter your current password' ]);
        if (!password_verify($data['oldpw'], $password)) send_and_exit([ 'modalerror' => 'Invalid current password entered' ]);
      }
      if ($data['newpw'] === '') store_setting('password', '');
      else store_setting('password', password_hash($data['newpw'], PASSWORD_DEFAULT));
    }
    send_and_exit([ 'settings' => 'stored' ]);
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
      case 'list':
        $keys = json_decode(query_setting('webauthnkeys', '[]'));
        foreach ($keys as $key) {
          $ret[] = dechex(crc32(implode('', $key->id)));
        }
        send_and_exit([ 'webauthn' => 'list', 'keys' => $ret ]);
        break;
      default:
        fatalerr('Invalid webauthn mode');
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
    return null;
  }
  return $value;
}

function add_note() {
  global $dbh;
  if (!$dbh->query("INSERT INTO note (content) VALUES ('')")) {
    $err = $dbh->errorInfo();
    error_log("add_note() query failed: " . $err[2]);
    return null;
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
  for ($i = 0; $matches[1][$i]; $i++) {
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

  if ($note['pinned']) {
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

  if ($note['cursor']) $cursor = implode(',', $note['cursor']);
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

/* * * * * * * * * * * * * *
 *                         *
 *   SQL helper functions  *
 *                         *
 * * * * * * * * * * * * * */
function sql_if($query, $params = []) {
  global $dbh;
  if (!empty($params)) {
    if (!($stmt = $dbh->prepare($query))) {
      error_log("if_query() prepare failed: " . $dbh->errorInfo()[2]);
      return false;
    }
    if (!($stmt->execute($params))) {
      error_log("if_query() execute failed: " . $stmt->errorInfo()[2]);
      return false;
    }
    if (!($row = $stmt->fetch(PDO::FETCH_NUM))) return false;
  }
  else {
    if (!($res = $dbh->query($query))) {
      error_log("if_query() query failed: " . $dbh->errorInfo()[2]);
      return false;
    }
    if (!($row = $res->fetch(PDO::FETCH_NUM))) return false;
  }
  if ($row[0]) return true;
  return false;
}
function sql_foreach($query, $function, $params = []) {
  global $dbh;
  if (!empty($params)) {
    if (!($stmt = $dbh->prepare($query))) {
      error_log("sql_foreach() prepare failed: " . $dbh->errorInfo()[2]);
      return false;
    }
    if (!($stmt->execute($params))) {
      error_log("sql_foreach() execute failed: " . $stmt->errorInfo()[2]);
      return false;
    }
  }
  else {
    if (!($stmt = $dbh->query($query))) {
      error_log("sql_foreach() query failed: " . $dbh->errorInfo()[2]);
      return false;
    }
  }
  while ($row = $stmt->fetch()) $function($row);
}
function sql_single($query, $params = []) {
  global $dbh;
  if (!empty($params)) {
    if (!($stmt = $dbh->prepare($query))) {
      error_log("if_query() prepare failed: " . $dbh->errorInfo()[2]);
      return "";
    }
    if (!($stmt->execute($params))) {
      error_log("if_query() execute failed: " . $stmt->errorInfo()[2]);
      return "";
    }
  }
  else {
    if (!($stmt = $dbh->query($query))) {
      error_log("if_query() query failed: " . $dbh->errorInfo()[2]);
      return "";
    }
  }
  if (!($row = $stmt->fetch(PDO::FETCH_NUM))) return "";
  return $row[0];
}
function sql_insert_id($query, $params = []) {
  global $dbh;
  if (!empty($params)) {
    if (!($stmt = $dbh->prepare($query))) {
      error_log("sql_insert_id() prepare failed: " . $dbh->errorInfo()[2]);
      return false;
    }
    if (!($stmt->execute($params))) {
      error_log("sql_insert_id() execute failed: " . $stmt->errorInfo()[2]);
      return false;
    }
  }
  else {
    if (!($stmt = $dbh->query($query))) {
      error_log("sql_insert_id() query failed: " . $dbh->errorInfo()[2]);
      return false;
    }
  }
  if ($stmt->rowCount() != 1) return false;
  return $dbh->lastInsertId();
}
function sql_updateone($query, $params = []) {
  global $dbh;
  if (!empty($params)) {
    if (!($stmt = $dbh->prepare($query))) {
      error_log("sql_updateone() prepare failed: " . $dbh->errorInfo()[2]);
      return false;
    }
    if (!($stmt->execute($params))) {
      error_log("sql_updateone() execute failed: " . $stmt->errorInfo()[2]);
      return false;
    }
  }
  else {
    if (!($stmt = $dbh->query($query))) {
      error_log("sql_updateone() query failed: " . $dbh->errorInfo()[2]);
      return false;
    }
  }
  if ($stmt->rowCount() != 1) return false;
  return true;
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
