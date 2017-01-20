var app = {
  mode: 'edit',
  activenote: 1,
  notes: {},
  inactive: 0,
  changed: 0
}

$(document).on('keydown', function(evt) {
  if (evt.key == 'F4') {
    if (app.mode == 'edit') app.mode = 'view';
    else if (app.mode == 'view') app.mode = 'edit';
    updatePanels();
  }
});

$().ready(function() {
  $('#render').hide();
  $.ajax('data.php').done(parseFromServer).always(function() { setInterval(tick, 10000); });
  $('#input').on('input', function() {
    if (!app.changed) app.changed = Date.now();
    app.notes[app.activenote].touched = true;
    app.inactive = 0;
  })
  $(window).on('unload', function() { // Use navigator.sendBeacon for this in the future
    if (app.changed) {
      app.notes[app.activenote].content = $('#input').val();
      pushToServer(true);
    }
  });
});

function tick() {
  app.inactive++;
  if (app.changed && ((app.inactive > 1) || (Date.now()-app.changed > 60000))) {
    app.changed = 0;
    if (app.notes[app.activenote].touched) app.notes[app.activenote].content = $('#input').val();
    pushToServer();
  }
}

function pushToServer(sync) {
  let data = { mode: 'update', activenote: app.activenote, notes: {} };
  let async = true;
  if (sync) async = false;
  for (let i in app.notes) {
    if (app.notes[i].touched) {
      data.notes[i] = app.notes[i];
      delete app.notes[i].touched;
    }
  }
  $.post({ url: 'data.php', data: JSON.stringify(data), contentType: 'application/json', async: async }).done(parseFromServer);
}
function parseFromServer(data) {
  if (data.error) {
    alert('Error: ' + data.error);
    return;
  }
  if (data.mode) app.mode = data.mode;
  if (data.activenote) app.activenote = data.activenote;
  for (let i in data.notes) {
    if (!app.notes[i]) app.notes[i] = {};
    if (data.notes[i].content) app.notes[i].content = data.notes[i].content;
    if ((i == app.activenote) && !app.notes[app.activenote].touched) $('#input').val(app.notes[app.activenote].content);
  }
  updatePanels();
}
function updatePanels() {
  if (app.mode == 'edit') {
    $('#render').hide().empty();
    $('#input').show();
  }
  else if (app.mode == 'view') {
    $('#input').hide();
    $('#render').html(marked($('#input').val())).show();
  }
}

$.fn.getCursorPosition = function() {
  var el = $(this).get(0);
  var pos = 0;
  if ('selectionStart' in el) {
    pos = el.selectionStart;
  } else if('selection' in document) {
    el.focus();
    var Sel = document.selection.createRange();
    var SelLength = document.selection.createRange().text.length;
    Sel.moveStart('character', -el.value.length);
    pos = Sel.text.length - SelLength;
  }
  return pos;
}
$.fn.setCursorPosition = function(pos) {
  this.each(function(index, elem) {
    if (elem.setSelectionRange) {
      elem.setSelectionRange(pos, pos);
    } else if (elem.createTextRange) {
      var range = elem.createTextRange();
      range.collapse(true);
      range.moveEnd('character', pos);
      range.moveStart('character', pos);
      range.select();
    }
  });
  return this;
};
