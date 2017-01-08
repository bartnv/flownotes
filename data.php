<?

$dbh = new PDO('sqlite:notes.sq3');

if (!empty($_GET['mode'])) $mode = $_GET['mode'];
elseif (!empty($_POST['mode'])) $mode = $_POST['mode'];
else $mode = 'init';

switch ($mode) {
  case 'init':
    $ret = [];
    $ret['mode'] = query_setting('mode', 'edit');
    $ret['activenote'] = query_setting('activenote', '1');
    $note = query_notes_id($ret['activenote']);
    $ret['notes'] = [ $ret['activenote'] => $note ];
    header('Content-type: application/json');
    print json_encode($ret);
  break;
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
