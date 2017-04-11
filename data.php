<?

$dbh = new PDO('sqlite:db/notes.sq3');

header('Content-type: application/json');

if ($_SERVER['REQUEST_METHOD'] != 'POST') fatalerr('Invalid request method');
if (!($data = json_decode(file_get_contents("php://input"), true))) fatalerr('Invalid JSON data in request body');
if (empty($data['req'])) fatalerr('No req specified in POST request');

if (!empty($data['activenote']) && is_numeric($data['activenote'])) $activenote = store_setting('activenote', $data['activenote']);
else $activenote = query_setting('activenote', '1');

$ret = [];

switch ($data['req']) {
  case 'init':
    $ret['mode'] = query_setting('mode', 'edit');
    $ret['activenote'] = $activenote;
    $ret['activetableft'] = query_setting('activetableft', 'recent');
    $ret['notes'] = select_recent_notes(20);
    $ret['notes'] = select_pinned_notes(20) + $ret['notes'];
    $ret['notes'][$activenote] = select_note($activenote);
    break;
  case 'idle':
    $ret['mode'] = query_setting('mode', 'edit');
    $ret['activenote'] = $activenote;
    break;
  case 'update':
    $ret['notes'] = [];
    if (!empty($data['notes'])) {
      foreach ($data['notes'] as $id => $note) {
        if (isset($note['content'])) $ret['notes'] = update_note($id, $note) + $ret['notes'];
        else $ret['notes'][$id]['pinned'] = update_note_pinned($id, $note);
      }
    }
    break;
  case 'activate':
    $ret['notes'] = [];
    $ret['notes'][$activenote] = select_note($activenote);
    if (!empty($data['lazy']) && $data['lazy'] && !empty($data['modified']) && ($data['modified'] == $ret['notes'][$activenote]['modified'])) unset($ret['notes']);
    if (!empty($data['mode'])) store_setting('mode', $data['mode']);
    break;
  case 'search':
    if (empty($data['term'])) fatalerr('No term passed in req search');
    $ret['notes'] = search_notes($data['term']);
    $ret['searchresults'] = array_keys($ret['notes']);
    break;
  case 'add':
    $ret['mode'] = store_setting('mode', 'edit');
    $ret['notes'] = [];
    $activenote = add_note();
    $ret['activenote'] = $activenote;
    $ret['notes'][$activenote] = select_note($activenote);
    break;
  default:
    fatalerr('Invalid request');
}

if (!empty($data['lastupdate']) && ($data['lastupdate'] < query_setting('lastupdate', 0))) {
  if (empty($ret['notes'])) $ret['notes'] = select_notes_since($data['lastupdate']);
  else $ret['notes'] = select_notes_since($data['lastupdate']) + $ret['notes'];
}
print json_encode($ret);
exit();

function query_setting($setting, $def = '') {
  global $dbh;
  if (!($res = $dbh->query("SELECT value FROM setting WHERE name = '$setting'"))) {
    $err = $dbh->errorInfo();
    error_log("query_setting() failed: " . $err[2]);
    return $def;
  }
  if (!($row = $res->fetch())) {
    error_log("query_setting() for setting $setting returned no rows");
    return $def;
  }
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
  if (!($row = $stmt->fetch(PDO::FETCH_ASSOC))) {
    error_log("select_note() select for id $id returned no rows");
    return [];
  }
  if ($row['flinks']) $row['flinks'] = array_map('intval', array_unique(explode(',', $row['flinks'])));
  if ($row['blinks']) $row['blinks'] = array_map('intval', array_unique(explode(',', $row['blinks'])));
  return $row;
}
function select_recent_notes($count) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, modified, title FROM note ORDER BY modified DESC LIMIT $count"))) {
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
  if (!($stmt = $dbh->prepare("SELECT id, modified, title, pinned FROM note WHERE pinned > 0 ORDER BY pinned DESC LIMIT $count"))) {
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
  if (!($stmt = $dbh->prepare("SELECT id, modified, title FROM note WHERE modified > ?"))) {
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
  if (!($stmt = $dbh->prepare("SELECT id, modified, title FROM note WHERE content LIKE ?"))) {
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

  $GLOBALS['extra_ids'] = [ $id ];
  if (!sql_if("SELECT 1 FROM note WHERE id = ? AND title = ?", [ $id, $note['title'] ])) { // Note changed title
    sql_foreach("SELECT * FROM link WHERE target = $id AND name IS NULL",
      function($row) use ($note) {
        $GLOBALS['extra_ids'][] = $row['source'];
        update_backlinks($row['source'], $row['target'], $note['title']);
      }
    );
  }
  if (!($stmt = $dbh->prepare("UPDATE note SET content = ?, title = ?, modified = strftime('%s', 'now'), pinned = ? WHERE id = ?"))) {
    $err = $dbh->errorInfo();
    error_log("update_note() update prepare failed: " . $err[2]);
    return;
  }
  if (!($stmt->execute([ $note['content'], $note['title'], $pinned, $id ]))) {
    $err = $stmt->errorInfo();
    $processUser = posix_getpwuid(posix_geteuid());
    error_log("update_note() update execute failed: " . $err[2] . ' (userid: ' . json_encode($processUser) . ')');
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
function update_note_pinned($id, $note) {
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
  if (!($stmt = $dbh->prepare("UPDATE note SET pinned = ? WHERE id = ?"))) {
    $err = $dbh->errorInfo();
    error_log("update_note_pinned() update prepare failed: " . $err[2]);
    return 0;
  }
  if (!($stmt->execute([ $pinned, $id ]))) {
    $err = $stmt->errorInfo();
    $processUser = posix_getpwuid(posix_geteuid());
    error_log("update_note_pinned() update execute failed: " . $err[2] . ' (userid: ' . json_encode($processUser) . ')');
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
      error_log("if_query() prepare failed: " . $dbh->errorInfo()[2]);
      return false;
    }
    if (!($stmt->execute($params))) {
      error_log("if_query() execute failed: " . $stmt->errorInfo()[2]);
      return false;
    }
  }
  else {
    if (!($stmt = $dbh->query($query))) {
      error_log("if_query() query failed: " . $dbh->errorInfo()[2]);
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

function fatalerr($msg) {
  print json_encode([ 'error' => $msg ]);
  exit(1);
}
