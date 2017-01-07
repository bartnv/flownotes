var app = {
  mode: 'edit',
  activenote: 1,
  notes: {}
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
  $.ajax('data.php').done(parseFromServer);
})

function parseFromServer(data) {
  if (data.mode) app.mode = data.mode;
  if (data.activenote) app.activenote = data.activenote;
  for (let i in data.notes) {
    if (!app.notes[i]) app.notes[i] = {};
    if (data.notes[i].content) app.notes[i].content = data.notes[i].content;
  }
  updatePanels();
}
function updatePanels() {
  $('#input').val(app.notes[app.activenote].content);
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
