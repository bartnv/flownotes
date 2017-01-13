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
    $note = query_notes_id($ret['activenote']);
    $ret['notes'] = [ $ret['activenote'] => $note ];
    print json_encode($ret);
    exit();
  case 'update':
    error_log(json_encode($data));
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

function query_notes_id($id) {
  global $dbh;
  if (!($stmt = $dbh->prepare("SELECT * FROM note WHERE id = ?"))) {
    $err = $dbh->errorInfo();
    error_log("query_notes_id() prepare failed: " . $err[2]);
    return [];
  }
  if (!($stmt->execute([ $id ]))) {
    $err = $stmt->errorInfo();
    error_log("query_notes_id() execute failed: " . $err[2]);
    return [];
  }
  if (!($row = $stmt->fetch(PDO::FETCH_ASSOC))) {
    error_log("query_notes_id() for id $id returned no rows");
    return [];
  }
  return $row;
}

function fatalerr($msg) {
  print json_encode([ 'error' => $msg ]);
  exit(1);
}
