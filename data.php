<?

$dbh = new PDO('sqlite:notes.sq3');

header('Content-type: application/json');

if ($_SERVER['REQUEST_METHOD'] == 'GET') {
  if (!empty($_GET['mode'])) $mode = $_GET['mode'];
  else $mode = 'init';
}
elseif ($_SERVER['REQUEST_METHOD'] == 'POST') {
  if (!($data = json_decode(file_get_contents("php://input"), true))) fatalerr('Invalid JSON data in request body');
  if (!empty($data['mode'])) $mode = $data['mode'];
  else fatalerr('No mode specified in POST request');
}
else fatalerr('Invalid request method');

switch ($mode) {
  case 'init':
    $ret = [];
    $ret['mode'] = query_setting('mode', 'edit');
    $ret['activenote'] = query_setting('activenote', '1');
    $ret['notes'] = select_all_notes();
    $note = select_note($ret['activenote']);
    $ret['notes'][$ret['activenote']]['content'] = $note['content'];
    print json_encode($ret);
    exit();
  case 'update':
    if (!empty($data['notes'])) {
      foreach ($data['notes'] as $id => $note) {
        update_note($id, $note);
      }
    }
    print '{ }';
    exit();
  case 'activate':
    if (empty($data['activenote'])) fatalerr('No activenote passed in mode activate');
    if (!is_numeric($data['activenote'])) fatalerr('Invalid activenote passed in mode activate');
    store_setting('activenote', $data['activenote']);
    $ret = [];
    $ret['notes'] = [];
    $ret['notes'][$data['activenote']] = select_note($data['activenote']);
    print json_encode($ret);
    exit();
  default:
    fatalerr('Invalid mode requested');
}

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
    return;
  }
  if (!($stmt->execute([ $setting, $value ]))) {
    $err = $stmt->errorInfo();
    error_log("store_setting() execute failed: " . $err[2]);
    return;
  }
}

function select_note($id) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT * FROM note WHERE id = ?"))) {
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

  if (!($stmt = $dbh->prepare("UPDATE note SET accessed = strftime('%s', 'now') WHERE id = ?"))) {
    $err = $dbh->errorInfo();
    error_log("select_note() update prepare failed: " . $err[2]);
  }
  if (!($stmt->execute([ $id ]))) {
    $err = $stmt->errorInfo();
    $processUser = posix_getpwuid(posix_geteuid());
    error_log("select_note() update execute failed: " . $err[2] . ' (userid: ' . json_encode($processUser) . ')');
  }
  return $row;
}
function select_all_notes() {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT id, accessed, modified, title FROM note ORDER BY modified DESC"))) {
    $err = $dbh->errorInfo();
    error_log("select_all_notes() prepare failed: " . $err[2]);
    return [];
  }
  if (!($stmt->execute())) {
    $err = $stmt->errorInfo();
    error_log("select_all_notes() execute failed: " . $err[2]);
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
  if (!($stmt = $dbh->prepare("UPDATE note SET content = ?, title = ?, modified = strftime('%s', 'now') WHERE id = ?"))) {
    $err = $dbh->errorInfo();
    error_log("update_note() prepare failed: " . $err[2]);
    return;
  }
  if (!($stmt->execute([ $note['content'], $note['title'], $id ]))) {
    $err = $stmt->errorInfo();
    $processUser = posix_getpwuid(posix_geteuid());
    error_log("update_note() execute failed: " . $err[2] . ' (userid: ' . json_encode($processUser) . ')');
    return;
  }
}

function fatalerr($msg) {
  print json_encode([ 'error' => $msg ]);
  exit(1);
}
