var app = {
  mode: 'edit'
}

$(document).on('keydown', function(evt) {
  if (evt.key == 'F4') {
    if (app.mode == 'edit') {
      app.mode = 'render';
      $('#input').hide();
      $('#render').html(marked($('#input').val())).show();
    }
    else {
      app.mode = 'edit';
      $('#render').hide().empty();
      $('#input').show();
    }
  }
});

$().ready(function() {
  $('#render').hide();
})

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
