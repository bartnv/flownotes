'use strict';

let app = {
  init: false,
  mode: 'edit',
  activenote: null,
  snapshots: null,
  notes: [],
  recent: 0,
  inactive: 0,
  changed: 0,
  offline: 0,
  lastupdate: 0,
  lastcomm: Date.now(),
  modal: null,
  password: false,
  hidepanelleft: false,
  hidepanelright: true,
  lastpanelright: 'links',
  keys: [],
  scroll: { recent: 0, search: 0, pinned: 0 },
  loader: $('<div class="loader"><div></div><div></div><div></div><div></div></div>')
}

$(document).on('keydown', function(evt) {
  if (evt.key == 'F2') {
    if (app.mode == 'graph') switchMode(app.prev);
    else switchMode('graph');
    return false;
  }
  else if (evt.key == 'F4') {
    if (app.mode == 'view') switchMode('edit');
    else switchMode('view');
    return false;
  }
  else if (evt.key == 'Escape') {
    if (app.modal && (app.modal != 'password')) hideModal();
  }
});
function goFullscreen() {
  $('#panel-main')[0].requestFullscreen();
}

$().ready(function() {
  marked.setOptions({
    breaks: true,
    smartypants: true
  });
  app.renderer = new marked.Renderer();
  app.renderer.link = function(href, title, text) {
    if (title == null) title = '';
    if (href.match(/^#[0-9]+$/)) {
      if (text.startsWith('=') && (text != '=')) title = text = text.substring(1);
      else if (app.notes[href.substring(1)]) title = app.notes[href.substring(1)].title;
      return '<a class="link-note" href="' + href + '" title="' + title + '">' + text + '</a>';
    }
    return '<a class="link-ext" href="' + href + '" title="' + title + '" target="_blank">' + text + '</a>';
  }
  app.renderer.code = function(code, info, escaped) {
    return '<pre><code>' + code + '</code></pre>';
  }
  app.renderer.codespan = function(code) {
    return '<code>' + code.replace('&amp;', '&') + '</code>';
  }
  app.graph = new sigma('graph');
  app.graph.settings({
    labelSize: 'proportional',
    labelSizeRatio: 2,
    labelThreshold: 4,
    defaultNodeColor: '#9ABCBD',
    sideMargin: 10
  });
  app.graph.bind('clickNode', function(evt) {
    location.hash = '#' + evt.data.node.id;
  });

  init();

  $('#input').on('keydown', function(e) {
    if (!e.key.startsWith('F')) {
      e.stopPropagation();
      if (!app.changed) app.changed = Date.now();
    }

    if ((e.key != 'Enter') && (e.key != 'Backspace')) app.prepended = null;

    if (e.ctrlKey && (e.key == 'Enter')) {
      app.addlink = true;
      sendToServer({ req: 'add', lastupdate: app.lastupdate });
      $('#status').html('Loading...').css('opacity', 1);
    }
    else if (e.altKey && (e.key == 'Enter')) {
      let input = $('#input')[0];
      cursorActivate(input.value, input.selectionStart);
    }
    else if (e.shiftKey && (e.key == 'Enter')) {
      // Reserved for future use
      return false;
    }
    else if (e.key == 'Enter') {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition();
      let start = content.lastIndexOf("\n", cursor.start-1);
      if (start == -1) start = 0;
      else start += 1;
      let line = content.substring(start, cursor.start);
      let pre = /^[ *-]*(\[ \])?[ *-]+/.exec(line);
      if (pre && (pre[0].length < cursor.start-start)) app.prepend = pre[0];
    }
    else if (e.ctrlKey && (e.key == 'ArrowUp')) {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition();
      let start1 = content.lastIndexOf("\n", cursor.start-1);
      if (start1 == -1) return false;
      else if (start1 == 0) start1 = 1; // Empty first line
      let end1 = content.indexOf("\n", cursor.end);
      if (end1 == -1) {
        end1 = content.length;
        if (end1-start1 == 1) return false;
      }
      let start2 = content.lastIndexOf("\n", start1-1);
      if (start2 == -1) start2 = 0;
      let newcontent = content.substring(0, start2) + content.substring(start1, end1) + content.substring(start2, start1) + content.substring(end1);
      $('#input').val(newcontent).setCursorPosition(start2+cursor.start-start1, start2+cursor.end-start1).trigger('input');
      return false;
    }
    else if (e.ctrlKey && (e.key == 'ArrowDown')) {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition();
      let start1 = content.lastIndexOf("\n", cursor.start-1);
      if (start1 == -1) start1 = 0;
      let end1 = content.indexOf("\n", cursor.end);
      if (end1 == -1) return false;
      let end2 = content.indexOf("\n", end1+1);
      if (end2 == -1) end2 = content.length;
      let newcontent = content.substring(0, start1) + content.substring(end1, end2) + content.substring(start1, end1) + content.substring(end2);
      $('#input').val(newcontent).setCursorPosition(start1+end2-end1+cursor.start-start1, start1+end2-end1+cursor.end-start1).trigger('input');
      return false;
    }
  }).on('input', function(e) {
    if (app.prepended) { // Previous keystroke prepended text
      if ((e.originalEvent.inputType == 'insertLineBreak') || (e.originalEvent.inputType == 'deleteContentBackward')) {
        let content = $('#input').val();
        let cursor = $('#input').getCursorPosition().start;
        let len = app.prepended.length;
        if (e.originalEvent.inputType == 'insertLineBreak') { // Enter pressed
          $('#input')
            .val(content.substring(0, cursor-len-1) + content.substring(cursor-1))
            .setCursorPosition(cursor-len);
        }
        else { // Backspace pressed
          $('#input')
            .val(content.substring(0, cursor-len+1) + content.substring(cursor))
            .setCursorPosition(cursor-len+1);
        }
        app.prepend = null;
      }
      app.prepended = null;
    }
    if (app.prepend) {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition().start;
      $('#input')
        .val(content.substring(0, cursor) + app.prepend + content.substring(cursor))
        .setCursorPosition(cursor + app.prepend.length);
      app.prepended = app.prepend;
      app.prepend = null;
    }
    if (!app.changed) app.changed = Date.now();
    app.notes[app.activenote].touched = true;
    app.inactive = 0;
    if (!app.offline && (app.lastcomm < Date.now()-90000)) $('#status').html('No communication with server; changes are not being saved').css('opacity', 1);
    updateStats();
  }).on('mouseup', function(evt) {
    if (evt.altKey && !evt.ctrlKey && !evt.shiftKey) {
      let input = $('#input')[0];
      cursorActivate(input.value, input.selectionStart);
    }
  }).on('focus', function() {
    if ($('#panel-main').width() < parseInt($('#panel-main').css('min-width'))) {
      togglePanelLeft('close');
      togglePanelRight('close');
    }
  });
  $('#render').on('click', function() {
    if ($('#panel-main').width() < parseInt($('#panel-main').css('min-width'))) {
      togglePanelLeft('close');
      togglePanelRight('close');
    }
  });
  $('#render').on('click', 'code', function () {
    if (window.getSelection().type == 'Range') return;
    if (!navigator.clipboard) {
      console.err("Browser doesn't support the Clipboard API");
      return;
    }
    navigator.clipboard.writeText($(this).text());
    selectText(this);
  });
  $('#modal-overlay').on('keydown', function(e) { e.stopPropagation(); }); // Avoid hotkeys bubbling up from the modal
  $(document).on('keydown', function(e) {
    if (e.ctrlKey) return;
    switch (e.keyCode) {
      case 83: $('#label-search').click();
                   return false;
      case 82: $('#label-recent').click().focus();
                   return false;
      case 80: $('#label-pinned').click().focus();
                   return false;
      case 78: $('#button-note-add').click();
                   return false;
    }
  });
  $(window).on('hashchange', function(e) {
    if (location.hash.match(/^#[0-9]+$/)) {
      let id = parseInt(location.hash.substring(1), 10);
      if (id != app.activenote) activateNote(id);
      if (app.snap) {
        app.snap = null;
        loadNote(id);
      }
    }
    else {
      let match = location.hash.match(/^#([0-9]+)@([0-9]+)$/);
      if (match) {
        let id = parseInt(match[1], 10);
        app.snap = match[2];
        if (id != app.activenote) activateNote(id, true);
        $('#stats').hide();
        if (app.snapshots === null) {
          sendToServer({ req: 'snapshot', mode: 'list', note: app.activenote });
          $('#status').html('Loading...').css('opacity', 1);
        }
        else {
          for (let snap of app.snapshots) {
            if (snap.modified == app.snap) {
              loadSnap(snap);
              return;
            }
          }
          $('#status').html('Snapshot @' + app.snap + ' not found').css('opacity', 1);
        }
      }
    }
  }).on('unload', function() {
    if (app.changed) {
      app.notes[app.activenote].content = $('#input').val();
      pushUpdate(true);
    }
    localStorage.setItem('flownotes-activenote', app.activenote);
    localStorage.setItem('flownotes-hidepanelleft', app.hidepanelleft);
    localStorage.setItem('flownotes-hidepanelright', app.hidepanelright);
  });
  $('#label-recent').on('click', function() { activateTab('recent'); });
  $('#label-search').on('click', function() {
    activateTab('search');
    $('#search-input').select();
  });
  $('#label-pinned').on('click', function() { activateTab('pinned'); });
  $('#search-input').on('keydown', function(e) {
    if (e.key == 'Enter') $('#search-button').click();
    if (!e.key.startsWith('F')) e.stopPropagation();
  });
  $('#search-button').on('click', function() {
    sendToServer({ req: 'search', term: $('#search-input').val(), lastupdate: app.lastupdate });
    $('#search-input').select();
    $('#search-results').empty().append(app.loader);
  });
  $('#button-panel-left-hide').on('click', togglePanelLeft);
  $('#button-panel-right-hide').on('click', togglePanelRight);
  $('#panel-left,#panel-right').on('mousedown', '.note-li', function (evt) {
    app.linkid = $(evt.currentTarget).addClass('note-selected').data('id');
    $('body').css('cursor', 'alias');
    $('#input').css('cursor', 'inherit');
    return false;
  }).on('keyup', 'a', function(evt) {
    if (evt.originalEvent.code == 'Space') this.click();
  });
  $('#input').on('mouseup', function() {
    let input = $(this);
    if (!app.linkid) {
      if (!app.changed) app.changed = Date.now();
      return;
    }
    let content = input.val();
    if (this.selectionStart != this.selectionEnd) { // We have text selected, use as linktext
      var linkstr = '[' + content.substring(this.selectionStart, this.selectionEnd) + '](#' + app.linkid + ')';
    }
    else var linkstr = '[=' + app.notes[app.linkid].title + '](#' + app.linkid + ')';
    let pos = this.selectionStart + linkstr.length;
    input.val(content.substring(0, this.selectionStart) + linkstr + content.substring(this.selectionEnd));
    this.setSelectionRange(pos, pos);
    input.trigger('input');
  });
  $(window).on('mouseup', function() {
    if (app.linkid) {
      $('.note-li[data-id="' + app.linkid + '"]').removeClass('note-selected');
      $('body').css('cursor', 'auto');
      $('#input').css('cursor', 'auto');
      app.linkid = null;
    }
  });
  $('#buttons-left').on('click', '.button-mode', function() {
    switchMode(this.id.split('-')[2]);
  });
  $('#buttons-right').on('click', '.button-mode', function() {
    let mode = this.id.split('-')[1];
    if ($('#button-' + mode).hasClass('button-active')) {
      togglePanelRight('close');
      return;
    }
    else if (app.hidepanelright) togglePanelRight('open');
    switch (mode) {
      case 'links':
        $('#button-links').addClass('button-active').siblings('.button-mode').removeClass('button-active');
        updateLinks();
        break;
    }
    app.lastpanelright = mode;
  });
  $('#panel-left,#buttons-left').on('touchstart', function(e) {
    app.touchstart = { from: 'left', pageX: e.changedTouches[0].pageX, pageY: e.changedTouches[0].pageY };
  });
  $('#panel-right,#buttons-right').on('touchstart', function(e) {
    app.touchstart = { from: 'right', pageX: e.changedTouches[0].pageX, pageY: e.changedTouches[0].pageY };
  });
  $('.tab').on('scroll', function(evt) {
    if (this.scrollTop == 0) $('#scrolled').hide();
    else $('#scrolled').show();
  });
  $('#tab-recent').on('scroll', function(evt) {
    if (this.offsetHeight + this.scrollTop >= this.scrollHeight-20) {
      let loader = $(this).find('.loader');
      if (app.recent == 'all') {
        loader.detach();
        return;
      }
      if (!loader.length) {
        $(this).append(app.loader);
        this.scrollBy({ top: app.loader.height(), behavior: 'smooth' });
        sendToServer({ req: 'recent', offset: app.recent });
      }
    }
  });
  $('#scrolled').on('click', function() {
    if ('scrollBehavior' in document.documentElement.style) $('.tab:visible')[0].scrollTo({ top: 0, behavior: 'smooth' });
    else $('.tab:visible')[0].scrollTo(0, 0);
  });
  $(window).on('touchend', function(e) {
    if (app.touchstart) {
      let end = e.changedTouches[0];
      if (Math.abs(app.touchstart.pageX-end.pageX) > Math.abs(app.touchstart.pageY-end.pageY)) { // Horizontal swipe
        if (end.pageX > app.touchstart.pageX+10) { // Swipe right
          if ((app.touchstart.from == 'left') && app.hidepanelleft) togglePanelLeft();
          else if ((app.touchstart.from == 'right') && !app.hidepanelright) togglePanelRight();
        }
        else if (end.pageX < app.touchstart.pageX-10) { // Swipe left
          if ((app.touchstart.from == 'left') && !app.hidepanelleft) togglePanelLeft();
          else if ((app.touchstart.from == 'right') && app.hidepanelright) togglePanelRight();
        }
      }
      app.touchstart = null;
    }
  });
  $('#button-note-add').on('click', function() {
    sendToServer({ req: 'add', lastupdate: app.lastupdate });
    $('#tab-recent').prepend(app.loader);
  });
  $('#button-note-pin').on('click', function() {
    if (app.notes[app.activenote].pinned) unpinNote(app.activenote);
    else {
      app.notes[app.activenote].pinned = true;
      let data = { req: 'update', notes: {}, lastupdate: app.lastupdate };
      data.notes[app.activenote] = {};
      data.notes[app.activenote].pinned = true;
      sendToServer(data);
      activateTab('pinned');
      $('#button-note-pin').addClass('button-active').attr('title', 'Unpin note');
    }
  });
  $('#button-note-mail').on('click', function() {
    let link = $('<a target="_blank" href="mailto:?body=' + encodeURIComponent($('#input').val()).replace(/%0A/gi, '%0D%0A') + '"></a>');
    $('body').append(link);
    link[0].click();
    link.remove();
  });
  $('#button-note-del').on('click', function() {
    if (app.notes[app.activenote].deleted) sendToServer({ req: 'delete', undelete: true, id: app.activenote, lastupdate: app.lastupdate });
    else if (confirm('Are you sure you want to delete note #' + app.activenote + ' "' + app.notes[app.activenote].title + '"?')) {
      sendToServer({ req: 'delete', id: app.activenote, lastupdate: app.lastupdate });
      $('#tab-recent .note-li').not('[data-id="' + app.activenote + '"]').first().click();
    }
  });
  $('#button-note-print').on('click', function() {
    if (app.mode == 'edit') iframePrint('<pre>' + $('#input').val() + '</pre>');
    else if (app.mode == 'view') iframePrint('<html><head><link rel="stylesheet" type="text/css" href="style.css"></head><body>' + $('#render').html() + '</body></html>');
  });
  $('#button-fullscreen').on('click', function() {
    goFullscreen();
  });
  $('#button-snapshots').on('click', loadSnapshots);
  $('#button-export').on('click', loadExports);
  $('#button-settings').on('click', loadSettings);
  $('#button-restore').on('click', function() {
    if (app.notes[app.activenote].modified > app.snapshots[app.snapshots.length-1].modified) {
      sendToServer({ req: 'snapshot', mode: 'add', note: app.activenote, locked: 0 });
    }
    let snapshot = null;
    for (let snap of app.snapshots) {
      if (snap.modified == app.snap) {
        snapshot = snap;
        break;
      }
    }
    if (!snapshot) return console.error('Snapshot ' + app.snap + ' not found');
    app.changed = Date.now()-60000; // Force a pushUpdate on the next tick
    let note = app.notes[app.activenote];
    note.touched = true;
    note.content = snapshot.content;
    note.title = snapshot.title;
    location.hash = '#' + note.id;
  });
  console.log('Event handlers initialized; starting interval timer');
  setInterval(tick, 4000);
});

function init() {
  let data = { req: 'init' };
  if (location.hash.match(/^#[^:]+:[0-9]+$/)) {
    let split = location.hash.indexOf(':');
    activateTab('search');
    data.term = location.hash.substring(1, split);
    $('#search-input').val(data.term);
    data.activenote = location.hash.substring(split+1);
    $('#search-results').append(app.loader);
  }
  else {
    activateTab('recent');
    if (location.hash.match(/^#[0-9]/)) {
      app.activenote = parseInt(location.hash.substring(1), 10);
      data.activenote = app.activenote;
    }
    else if (localStorage.getItem('flownotes-activenote')) {
      app.activenote = parseInt(localStorage.getItem('flownotes-activenote'), 10);
      data.activenote = app.activenote;
    }
    if (location.hash.indexOf('@') > -1) {
      app.snap = location.hash.substring(location.hash.indexOf('@')+1);
      data.snapshots = true;
    }
    $('#tab-recent').append(app.loader);
  }
  sendToServer(data);
}

function togglePanelLeft(force) {
  if ((force == 'close') || (!app.hidepanelleft && (force != 'open'))) {
    app.hidepanelleft = true;
    $('#button-panel-left-hide').removeClass('button-active').attr('title', 'Show left panel');
    $('#panel-left').css('margin-left', '-20rem');
  }
  else {
    app.hidepanelleft = false;
    $('#button-panel-left-hide').addClass('button-active').attr('title', 'Hide left panel');
    $('#panel-left').css('margin-left', '0');
    $('#panels').css({ left: '0', right: '' });
    if ((window.innerWidth < 880) && !app.hidepanelright) togglePanelRight('close');
  }
}
function togglePanelRight(force) {
  if ((force == 'open') || (app.hidepanelright && (force != 'close'))) {
    app.hidepanelright = false;
    $('#button-panel-right-hide').addClass('button-active').attr('title', 'Hide right panel');
    $('#panel-right').css('margin-right', '0');
    $('#panels').css({ left: '', right: '0' });
    $('#button-' + app.lastpanelright).click();
    if ((window.innerWidth < 880) && !app.hidepanelleft) togglePanelLeft('close');
  }
  else {
    app.hidepanelright = true;
    $('#button-panel-right-hide').removeClass('button-active').attr('title', 'Show right panel');
    $('#panel-right').css('margin-right', '-20rem');
    $('#buttons-right .button-mode').removeClass('button-active');
  }
}

function iframePrint(content) {
  let iframe = $('<iframe height="0" width="0" border="0" wmode="Opaque"/>')
    .prependTo('body')
    .css({
        "position": "absolute",
        "top": -999,
        "left": -999
    });
  let iwindow = iframe.get(0).contentWindow;
  iwindow.document.write(content);
  iwindow.document.close();
  iframe.on('load', function() {
    iwindow.print();
  });
}

function unpinNote(id) {
  if (!confirm('Are you sure you want to unpin note #' + id + ' (' + app.notes[id].title + ')?')) return;
  app.notes[id].pinned = 0;
  let data = { req: 'update', notes: {}, lastupdate: app.lastupdate };
  data.notes[id] = {};
  data.notes[id].pinned = 0;
  sendToServer(data);
  if ($('#label-pinned').hasClass('tab-active')) updatePinned();
  if (id == app.activenote) $('#button-note-pin').removeClass('button-active').attr('title', 'Pin note');
}
function loadNote(id) {
  if (app.notes[id].mode && (app.mode != app.notes[id].mode)) switchMode(app.notes[id].mode);
  if (app.mode == 'view') render(app.notes[id].content);
  else if (app.mode == 'graph') loadGraph();
  if (app.notes[id].pinned) $('#button-note-pin').addClass('button-active').attr('title', 'Unpin note');
  else $('#button-note-pin').removeClass('button-active').attr('title', 'Pin note');
  if (app.notes[id].deleted) {
    $('#input').attr('disabled', true);
    $('#button-note-del').addClass('button-active').attr('title', 'Undelete note');
  }
  else {
    $('#input').attr('disabled', false);
    $('#button-note-del').removeClass('button-active').attr('title', 'Delete note');
  }
  $('#input').val(app.notes[id].content).attr('readonly', false);
  if (app.notes[id].cursor) $('#input').setCursorPosition(app.notes[id].cursor.start, app.notes[id].cursor.end);
  if (app.mode == 'edit') $('#input').blur().focus();
  let active = $('#tab-recent .note-active')[0];
  if (active && !active.isInView()) active.customScrollIntoView();
  updateLink(app.notes[id]);
  $('#snap').hide();
}
function loadSnap(snap) {
  if (app.mode == 'view') render(snap.content);
  else if (app.mode == 'graph') switchmode('edit');
  $('#input').val(snap.content).attr('readonly', 'readonly');
  $('#snap').css('display', 'flex').find('#snapdate').text(new Date(snap.modified*1000).format('Y-m-d H:i'));
}

function render(content) {
  let el = $('#render');
  content = content.replace(/</g, '&lt;');
  content = content.replace(/\[( |x)\]/g, function(match, sub, offset) {
    return '<input type="checkbox"' + (sub == 'x'?' checked':'') + ' onchange="checkboxChange(this, ' + offset + ')"></input>';
  });
  content = content.replace(/\*`([^`]+)`/g, '<code onclick="passwordToClipboard(this, event);" data-pass="$1">*****</code>');
  el.html(marked(content, { renderer: app.renderer }));
  return el;
}
function renderToWindow(content) {
  content = content.replace(/</g, '&lt;');
  content = content.replace(/\[( |x)\]/g, function(match, sub, offset) {
    return '<input type="checkbox"' + (sub == 'x'?' checked':'') + ' onchange="checkboxChange(this, ' + offset + ')"></input>';
  });
  let win = window.open('', 'print', 'height=400,width=400');
  win.document.write('<html><head><title>' + app.notes[app.activenote].title + '</title>');
  win.document.write('<link rel="stylesheet" href="style.css"/></head><body>');
  win.document.write(marked(content, { renderer: app.renderer }));
  win.document.write('</body></html>');
  win.document.close();
  win.focus();
}

function checkboxChange(checkbox, offset) {
  let input = $('#input');
  let content = input.val();
  if (checkbox.checked) input.val(content.substring(0, offset+1) + 'x' + content.substring(offset+2));
  else input.val(content.substring(0, offset+1) + ' ' + content.substring(offset+2));
  input.trigger('input');
}
function passwordToClipboard(el, evt) {
  if (!navigator.clipboard) {
    console.err("Browser doesn't support the Clipboard API");
    return;
  }
  navigator.clipboard.writeText($(el).data('pass'));
  selectText(el);
  evt.stopPropagation();
}
function copy(btn) {
  selectText($(btn).parent().find('code').get(0));
  document.execCommand('copy');
  selectText(btn);
}

function cursorActivate(text, cursor) {
  if (text.charAt(cursor) == '\n') cursor -= 1;
  let end = text.indexOf('\n', cursor);
  if (end == -1) end = text.length;
  let start = text.lastIndexOf('\n', cursor)+1;
  let line = text.substring(start, end);
  let res;
  cursor -= start;
  if (line.charAt(cursor) == ' ') cursor -= 1;
  start = line.lastIndexOf('[', cursor);
  end = line.indexOf(')', cursor);
  if ((start != -1) && (end != -1)) {
    let mid = line.indexOf('](');
    if (mid == -1) return;
    res = line.substring(mid+2, end);
  }
  else {
    start = line.lastIndexOf(' ', cursor);
    end = line.indexOf(' ', cursor);
    if (end == -1) end = line.length;
    res = line.substring(start+1, end);
  }

  if (res.substring(0, 1) == '#') window.location = res;
  else if (res.substring(0, 4) == 'http') window.open(res, '_blank');
}

function tick() {
  app.inactive++;
  if (!app.init) {
    if (app.inactive%15 == 0) init();
  }
  else if (app.changed && ((app.inactive > 1) || (Date.now()-app.changed > 60000))) {
    app.changed = 0;
    let note = app.notes[app.activenote];
    if (note.touched) {
      note.content = $('#input').val();
      note.cursor = $('#input').getCursorPosition();
      note.title = findTitle(app.notes[app.activenote].content);
    }
    else {
      let cursor = $('#input').getCursorPosition();
      if (!note.cursor || (cursor.start != note.cursor.start) || (cursor.end != note.cursor.end)) {
        note.cursor = cursor;
        note.metatouched = true;
      }
    }
    pushUpdate();
  }
  else if (app.inactive%15 == 0) idle();
}
function idle() {
  sendToServer({ req: 'idle', lastupdate: app.lastupdate, activenote: app.activenote });
}

function pushUpdate(beacon, retransmit) {
  let data = { req: 'update', activenote: app.activenote, notes: {}, lastupdate: app.lastupdate };
  if ($('#label-search').hasClass('tab-active') && $('#search-input').val().length) data.term = $('#search-input').val();
  for (let i in app.notes) {
    if (app.notes[i].touched) {
      data.notes[i] = app.notes[i];
      delete app.notes[i].touched;
      delete app.notes[i].metatouched;
      app.notes[i].intransit = 'full';
    }
    else if (app.notes[i].metatouched) {
      data.notes[i] = {};
      data.notes[i].cursor = app.notes[i].cursor;
      data.notes[i].pinned = app.notes[i].pinned;
      data.notes[i].mode = app.notes[i].mode;
      delete app.notes[i].metatouched;
      if (!app.notes[i].intransit) app.notes[i].intransit = 'meta';
    }
  }
  if (retransmit) {
    for (let i in app.notes) {
      if (app.notes[i].intransit) {
        if (app.notes[i].intransit == 'full') data.notes[i] = app.notes[i];
        else if (!data.notes[i]) { // Don't overwrite touched note with intransit 'meta'
          data.notes[i] = {};
          data.notes[i].cursor = app.notes[i].cursor;
          data.notes[i].pinned = app.notes[i].pinned;
          data.notes[i].mode = app.notes[i].mode;
        }
      }
    }
  }
  sendToServer(data, beacon);
}

function sendToServer(data, beacon) {
  if (beacon) return navigator.sendBeacon('data.php', JSON.stringify(data));
  return $.post({ url: 'data.php', data: JSON.stringify(data), contentType: 'application/json' }).done(parseFromServer).fail(offline);
}
function parseFromServer(data, textStatus, xhr) {
  if (xhr.status != 200) return offline(xhr);
  if (data.error) return offline(data.error);
  if (data.alert) alert(data.alert);
  if (data.log) console.log(data.log);
  if (data.logout) return logout();
  if (!app.init) {
    app.init = true;
    if (localStorage.getItem('flownotes-hidepanelleft') == 'true') togglePanelLeft('close');
    if (localStorage.getItem('flownotes-hidepanelright') == 'false') togglePanelRight('open');
  }
  if (data.lastupdate) app.lastupdate = data.lastupdate;
  app.lastcomm = Date.now();
  if (app.offline) {
    app.offline = 0;
    pushUpdate(false, true);
  }

  $('#status').css('opacity', '0');

  if (data.needpass) {
    if ((app.modal == 'password') || (app.modal == 'logout')) return;
    clear();
    login(data.modalerror, data.challenge);
    $('.loader').detach();
    return;
  }
  if (data.password !== undefined) {
    app.password = data.password;
    hideModal();
  }
  if (data.settings && (app.modal == 'settings')) {
    if (data.settings == 'stored') hideModal();
    else {
      handleWebauthn(data);
      handleSettings(data.settings);
    }
    return;
  }
  if (data.webauthn) {
    handleWebauthn(data);
    return;
  }

  if (data.modalerror) {
    let error = $('#modal-error');
    if (error.length) error.html(data.modalerror);
    else showModal('error', '<div><p id="modal-error">' + data.modalerror + '</p></div>', true);
  }
  if (data.settings == 'stored') hideModal();

  if ((data.snapshots) && (data.note == app.activenote)) {
    app.snapshots = data.snapshots;
    if (app.modal == 'snapshots') {
      let div = $('#snapshots').empty();
      for (let snap of data.snapshots) {
        let str = '<li data-id="' + snap.id + '" data-modified="' + snap.modified + '">';
        str += '<span class="snap-title">' + snap.title + '</span><br>';
        str += '<span class="snap-modified">saved at ' + new Date(snap.modified*1000).format('Y-m-d H:i') + '</span><br>';
        let matches = snap.content.match(/\W\w/g);
        str += '<span class="snap-stats">chars: ' + snap.content.length + ' / words: ' + ((matches?matches:[]).length+(/^(\W|$)/.test(snap.content)?0:1)) + '</span>';
        if (snap.locked == 1) str += '<div class="snap-action snap-unlock" title="Unlock"></div>';
        else str += '<div class="snap-action snap-lock" title="Lock"></div><div class="snap-action snap-delete" title="Delete"></div>';
        str += '</li>';
        div.append(str);
      }
    }
    $(window).trigger('hashchange');
  }

  let reload = false;
  if (data.notes) {
    for (let i in data.notes) {
      if (!app.notes[i]) app.notes[i] = { id: i };
      if (data.notes[i].title) app.notes[i].title = data.notes[i].title;
      else if (!app.notes[i].title) app.notes[i].title = '{no title}';
      if (data.notes[i].modified) {
        app.notes[i].modified = data.notes[i].modified;
        if (app.notes[i].intransit) delete app.notes[i].intransit;
      }
      if (data.notes[i].pinned) app.notes[i].pinned = parseInt(data.notes[i].pinned);
      if (data.notes[i].deleted == 1) app.notes[i].deleted = true;
      else app.notes[i].deleted = false;
      if (data.notes[i].flinks !== undefined) app.notes[i].flinks = data.notes[i].flinks;
      if (data.notes[i].blinks !== undefined) app.notes[i].blinks = data.notes[i].blinks;
      if ((data.notes[i].content !== undefined) && (app.notes[i].content !== data.notes[i].content)) {
        app.notes[i].content = data.notes[i].content;
        if ((i == app.activenote) && !app.notes[app.activenote].touched) reload = true;
      }
      if (data.notes[i].cursor) {
        let pos = data.notes[i].cursor.split(',');
        app.notes[i].cursor = { start: pos[0], end: pos[1] };
      }
      if (data.notes[i].published !== undefined) {
        app.notes[i].published = data.notes[i].published;
        if (i == app.activenote) updateLink(app.notes[i]);
      }
      if (!app.notes[i].mode) app.notes[i].mode = data.notes[i].mode;
    }
    if (data.recent) app.recent = data.recent;
    updatePanels();
  }
  if (reload && !app.snap) {
    loadNote(app.activenote);
    if ($('#stats').is(':visible')) updateStats();
  }

  if (data.searchresults) listSearchResults(data.searchresults, data.search);
  if (app.notes[app.activenote]) {
    if (app.notes[app.activenote].deleted) {
      $('#input').attr('disabled', true);
      $('#status').html('Note #' + app.activenote + ' has been deleted').css('opacity', 1);
      $('#button-note-del').addClass('button-active').attr('title', 'Undelete note');
    }
    else {
      $('#input').attr('disabled', false);
      $('#button-note-del').removeClass('button-active').attr('title', 'Delete note');
    }
  }

  if (data.switchnote) { // App launched without note id in location hash OR new note created
    if (app.addlink) { // New note created with ctrl+enter
      let input = $('#input')[0];
      let start = input.selectionStart;
      let end = input.selectionEnd;
      let val = input.value;
      let name = '=';
      if (start != end) { // There is a text selection; use it as link text
        name = val.substring(start, end);
        app.notes[data.switchnote].title = findTitle(name);
        app.notes[data.switchnote].content = '# ' + name + '\n\n';
        app.notes[data.switchnote].touched = true;
      }
      let link = '[' + name + '](#' + data.switchnote + ')';
      input.value = val.substring(0, start) + link + val.substring(end);
      input.setSelectionRange(start+1, start+1+name.length);
      app.notes[app.activenote].content = input.value;
      app.notes[app.activenote].cursor = { start: input.selectionStart, end: input.selectionEnd };
      app.notes[app.activenote].touched = true;
      app.addlink = false;
      pushUpdate();
    }
    location.hash = '#'+data.switchnote;
  }
}
function offline(msg = 'Connection failed, switching to offline mode') {
  if (typeof msg != 'string') {
    if (msg.status) msg = 'Error from server: ' + msg.status + ' (' + msg.statusText + ')';
    else msg = 'No network connection';
  }
  if (!app.offline) {
    app.offline = Date.now();
    $('#status').html(msg).css('opacity', 1);
  }
  else {
    let count = 0;
    for (let i in app.notes) {
      if (app.notes[i].touched || (app.notes[i].intransit == 'full')) count++;
    }
    if (count) $('#status').html('Offline mode (' + count + ' unsaved note' + (count==1?'':'s') + ')').css('opacity', 1);
    else $('#status').html('Offline mode').css('opacity', 1);
  }
  if (app.notes[app.activenote] && (app.notes[app.activenote].content === undefined)) {
    $('#input').val('');
    $('#render').empty();
  }
}

function updateLink(note) {
  if (note.published && note.published[0] && note.published[0].file) {
    let location = new URL(window.location);
    let link = location.origin + location.pathname + note.published[0].file;
    let html = 'Published as ';
    switch (note.published[0].type) {
      case 'html': html += 'HTML'; break;
      case 'frag': html += 'HTML fragment'; break;
      default: html+= '?';
    }
    $('#link')
      .html(html + ' at <a href="' + link + '" target="_blank">' + note.published[0].file + '</a><div id="button-unpublish"></div>')
      .show()
      .find('#button-unpublish').on('click', function() {
        sendToServer({ req: 'export', mode: 'delone', note: note.id, type: note.published[0].type });
      });
  }
  else $('#link').hide();
}

function updateStats() {
  let val = $('#input').val();
  let matches = val.match(/\W\w/g);
  $('#stats').show().html('Chars: ' + val.length + '<br>Words: ' + ((matches?matches:[]).length+(/^(\W|$)/.test(val)?0:1)));
}

function handleWebauthn(data) {
  if (data.webauthn == 'register') {
    webauthnRegister(data.challenge, function(success, info) {
      if (success) {
        sendToServer({ req: 'webauthn', mode: 'register', response: info });
        showModal('webauthn', '<div><h2>Please wait...</h2><p>Registering U2F key on the server</p></div>', false);
      }
      else showModal('error', '<div><p id="modal-error">' + info + '</p></div>', true);
    });
  }
  else if (data.webauthn == 'registered') hideModal();
  else if (data.webauthn == 'list') {
    let str = '';
    for (let i in data.keys) {
      str += 'Key ' + (Number(i)+1) + ': ' + data.keys[i] + '<br>';
    }
    $('p#list-u2f').html(str);
  }
}

function switchMode(newmode) {
  app.prev = app.mode;
  app.mode = newmode;
  if (app.notes[app.activenote]) {
    if (!app.changed) app.changed = Date.now();
    app.notes[app.activenote].mode = newmode;
    app.notes[app.activenote].metatouched = true;
  }
  if (app.mode == 'edit') {
    $('#input').show().focus();
    $('#render').hide().empty();
    $('#graph').hide();
  }
  else if (app.mode == 'view') {
    $('#input,#graph,#stats').hide();
    render($('#input').val()).show();
  }
  else if (app.mode == 'graph') {
    $('#input,#stats').hide();
    $('#render').hide().empty();
    $('#graph').show();
    loadGraph();
  }
  $('#button-mode-' + app.mode).addClass('button-active').siblings('.button-mode').removeClass('button-active');
}
function loadGraph() {
  app.graph.graph.clear();
  app.graph.refresh();
  let note = app.notes[app.activenote];
  app.graph.graph.addNode({ id: String(app.activenote), label: note.title, x: 50, y: 0, size: 1, color: '#6BA2A5' });
  let y = 0;
  if (note.flinks) {
    for (let flink of note.flinks) {
      app.graph.graph.addNode({ id: flink.id, label: flink.title, x: 75, y: y, size: 1 });
      app.graph.graph.addEdge({ id: app.activenote + '-' + flink.id, source: String(app.activenote), target: flink.id });
      if (y > 0) y = -y;
      else y = -y+10;
    }
    y = 0;
  }
  if (note.blinks) {
    for (let blink of note.blinks) {
      app.graph.graph.addNode({ id: blink.id, label: blink.title, x: 25, y: y, size: 1 });
      app.graph.graph.addEdge({ id: app.activenote + '-' + blink.id, source: blink.id, target: String(app.activenote) });
      if (y > 0) y = -y;
      else y = -y+10;
    }
  }
  app.graph.refresh();
}

function updatePanels() {
  if ($('#label-pinned').hasClass('tab-active')) updatePinned();
  else if ($('#label-recent').hasClass('tab-active')) updateRecent();
  else updateSearch();

  if (!app.hidepanelright) {
    switch (app.lastpanelright) {
      case 'links':
        updateLinks();
        break;
    }
  }
}

function updateRecent() {
  let notes = Object.keys(app.notes).map(function(x) { return app.notes[x]; });
  notes = notes.filter(function(x) { return !x.deleted; });
  notes.sort(function(a, b) { return b.modified - a.modified; });
  let count = 0;
  let str = '';
  for (let i in notes) {
    let note = notes[i];
    let extraclass = '';
    if (note.id == app.activenote) extraclass = ' note-active';
    str += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '" data-id="' + note.id + '"><span class="note-title">' + note.title + '</span><br>';
    str += '<span class="note-modified">saved at ' + new Date(note.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
    if (++count >= app.recent) break;
  }
  $('#tab-recent').html(str);
}
function updateSearch() {
  let items = app.searchresults;
  if (!items) return;
  items.sort(function(a, b) { return app.notes[b].modified - app.notes[a].modified; });
  let results = "";
  for (let i in items) {
    let note = app.notes[items[i]];
    let extraclass = '';
    if (note.id == app.activenote) extraclass = ' note-active';
    if (note.deleted) extraclass += ' note-deleted';
    results += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '" data-id="' + note.id + '"><span class="note-title">' + note.title + '</span><br>';
    results += '<span class="note-modified">saved at ' + new Date(note.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
  }
  $('#search-results').empty().html(results);
}
function updatePinned() {
  let notes = Object.keys(app.notes).map(function(x) { return app.notes[x]; });
  notes.sort(function(a, b) { return (b.pinned||-1) - (a.pinned||-1); });
  let count = 0;
  let pinned = "";
  for (let i in notes) {
    let note = notes[i];
    if (!note.pinned) break;
    let extraclass = '';
    if (note.id == app.activenote) extraclass = ' note-active';
    if (note.deleted) extraclass += ' note-deleted';
    pinned += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '" data-id="' + note.id + '" draggable="true" ondragstart="drag(event)">';
    pinned += '<span class="note-title">' + note.title + '</span><br>';
    pinned += '<div class="button-unpin" onclick="unpinNote(' + note.id + '); return false;" title="Unpin"></div>';
    pinned += '<span class="note-modified">saved at ' + new Date(note.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
  }
  $('#tab-pinned').empty().html(pinned);
}
function updateLinks() {
  let note = app.notes[app.activenote];
  if (!note) return;
  let str = '<div class="list-divider">Links to this note</div>';
  if (note.blinks) {
    for (let blink of note.blinks) {
      let classes = 'note-li';
      if (blink.deleted == 1) classes += ' note-deleted';
      str += '<a href="#' + blink.id + '"><div class="' + classes + '" data-id="' + blink.id + '">';
      str += '<span class="note-title">' + blink.title + '</span><br>';
      str += '<span class="note-modified">saved at ' + new Date(blink.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
    }
  }
  else str += '<div class="list-none">- none -</div>';
  str += '<div class="list-divider">Links from this note</div>';
  if (note.flinks) {
    for (let flink of note.flinks) {
      let classes = 'note-li';
      if (flink.deleted == 1) classes += ' note-deleted';
      str += '<a href="#' + flink.id + '"><div class="' + classes + '" data-id="' + flink.id + '">';
      str += '<span class="note-title">' + flink.title + '</span><br>';
      str += '<span class="note-modified">saved at ' + new Date(flink.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
    }
  }
  else str += '<div class="list-none">- none -</div>';
  $('#tab-right').html(str);
}

function findTitle(text) {
  let matches = text.substring(0, 100).match(/([a-zA-Z\u00C0-\u024F0-9][a-zA-Z\u00C0-\u024F0-9 .\/\\'&-]+[a-zA-Z\u00C0-\u024F0-9])/mg);
  if (matches) {
    if (((matches[0] == 'http') || (matches[0] == 'https')) && matches[1]) return matches[1];
    return matches[0];
  }
  return '{no title}';
}

function activateNote(id, nopost) {
  if (app.notes[app.activenote] && app.notes[app.activenote].touched) {
    app.notes[app.activenote].content = $('#input').val();
    app.notes[app.activenote].title = findTitle(app.notes[app.activenote].content);
  }
  app.activenote = id;
  app.snapshots = null;
  $('.note-li').removeClass('note-active');
  $('a[href="#' + app.activenote + '"]').children().addClass('note-active');
  $('#stats').hide();
  if (!nopost) {
    let data = { req: 'activate', activenote: app.activenote, lastupdate: app.lastupdate };
    if (app.notes[id] && (app.notes[id].content !== undefined)) {
      loadNote(app.activenote);
      updatePanels();
      data.lazy = true;
      data.modified = app.notes[id].modified;
    }
    else {
      data.lazy = false;
      $('#input').attr('disabled', true);
      $('#status').html('Loading...').css('opacity', 1);
    }
    sendToServer(data);
    setTimeout(idle, 8000);
  }
  if (!app.hidepanelleft && ($('#buttons-right')[0].getBoundingClientRect().right > window.innerWidth)) {
    togglePanelLeft('close');
  }
  if (!app.hidepanelright && ($('#buttons-left')[0].getBoundingClientRect().left < 0)) {
    togglePanelRight('close');
  }
}
function activateTab(name) {
  $('#label-' + name).addClass('tab-active').siblings().removeClass('tab-active');
  $('#tab-' + name).show().siblings('.tab').hide();
  if ($('#tab-' + name).prop('scrollTop') == 0) $('#scrolled').hide();
  else $('#scrolled').show();
  if (name == 'search') $('#search-input').focus();
  updatePanels();
}

function listSearchResults(items, first) {
  app.searchresults = items;
  updateSearch();
  if (first && (items.length == 1)) {
    location.hash = '#' + app.notes[items[0]].id;
    setTimeout("$('#search-input').focus();", 100);
  }
}

function loadExports() {
  let div = $('<div><h1>Export functions</h1><div id="modal-body"></div></div>');
  let body = div.find('#modal-body');
  body.append('<p><input type="button" id="export-get-html-one" class="modal-button-small" value="Download current note as HTML"></p>');
  body.append('<p><input type="button" id="export-get-txt-all" class="modal-button-small" value="Download all notes as plain text"></p>');
  body.append('<p><input type="button" id="export-get-html-all" class="modal-button-small" value="Download all notes as HTML"></p>');
  body.append('<p><input type="button" id="export-pub-html-one" class="modal-button-small" value="Publish current note as HTML"></p>');
  body.append('<p><input type="button" id="export-pub-frag-one" class="modal-button-small" value="Publish current note as HTML fragment"></p>');
  body.find('#export-get-html-one').on('click', function() { window.location = 'data.php?export=htmlone&note=' + app.activenote; });
  body.find('#export-get-txt-all').on('click', function() { window.location = 'data.php?export=txtall'; });
  body.find('#export-get-html-all').on('click', function() { window.location = 'data.php?export=htmlall'; });
  body.find('#export-pub-html-one').on('click', function() {
    sendToServer({ req: 'export', mode: 'pubhtmlone', note: app.activenote });
    hideModal();
  });
  body.find('#export-pub-frag-one').on('click', function() {
    sendToServer({ req: 'export', mode: 'pubfragone', note: app.activenote });
    hideModal();
  });
  showModal('export', div, true);
}

function loadSettings() {
  let div = $('<div><h1>Settings</h1><div id="modal-body"></div></div>');
  let body = div.find('#modal-body');
  body.append('<h2>Logout</h2>');
  body.append('<p><input type="button" id="logout-this" class="modal-button-small" value="Logout this session"></p>');
  body.append('<p><input type="button" id="logout-all" class="modal-button-small" value="Logout all sessions"></p>');
  body.append('<h2>Password</h2>');
  if (app.password) body.append('<p><span class="settings-label">Current password:</span><input type="password" class="input-password" name="old" autocomplete="current-password"></p>');
  body.append('<p><span class="settings-label">New password:</span><input type="password" class="input-password" name="new1" autocomplete="new-password"></p>');
  body.append('<p><span class="settings-label">Repeat new:</span><input type="password" class="input-password" name="new2" autocomplete="new-password"></p>');
  body.append('<h2>U2F keys</h2>');
  body.append('<p id="list-u2f">Loading...</p>');
  body.append('<p><input type="button" id="register-u2f" class="modal-button-small" value="Register new U2F key"></p>');
  body.append('<h2>Automatic snapshots</h2>');
  body.append('<p><input type="checkbox" id="autosnap"> When editing, auto-snapshot every <input id="snapafter" class="input-smallint" type="number" min="1"> hours</p>');
  body.append('<p><input type="checkbox" id="autoprune"> Prune automatic snapshots after <input id="pruneafter" class="input-smallint" type="number" min="1"> days, keeping<br>snapshots <input id="prunedays" class="input-smallint" type="number" min="0"> days, <input id="pruneweeks" class="input-smallint" type="number" min="0"> weeks and <input id="prunemonths" class="input-smallint" type="number" min="0"> months apart');
  div.append('<p id="modal-error"></p>');
  div.append('<p><input type="button" id="settings-save" class="modal-button" value="Save"></p>');
  body.find('#logout-this').on('click', function() {
    sendToServer({ req: 'logout', session: 'this' });
    showModal('logout', '', false);
  });
  body.find('#logout-all').on('click', function() {
    sendToServer({ req: 'logout', session: 'all' });
    showModal('logout', '', false);
  });
  body.find('#register-u2f').on('click', function() {
    sendToServer({ req: 'webauthn', mode: 'prepare' });
  });
  div.find('#settings-save').on('click', function() {
    let data = { req: 'settings', mode: 'save' };
    let old = body.find('input[name=old]');
    let new1 = body.find('input[name=new1]');
    let new2 = body.find('input[name=new2]');
    if (new1.val().length || new2.val().length || (old.length && old.val().length)) {
      if (new1.val() != new2.val()) {
        div.find('#modal-error').html('Please verify your new password entries');
        return;
      }
      div.find('#modal-error').empty();
      if (old.length) data.oldpw = old.val();
      data.newpw = new1.val();
      if (data.newpw.length) app.password = true;
      else app.password = false;
    }
    data.autosnap = $('#autosnap').prop('checked');
    data.autoprune = $('#autoprune').prop('checked');
    data.snapafter = $('#snapafter').val();
    data.pruneafter = $('#pruneafter').val();
    data.prunedays = $('#prunedays').val();
    data.pruneweeks = $('#pruneweeks').val();
    data.prunemonths = $('#prunemonths').val();
    sendToServer(data);
    if (data.length > 1) $('#status').html('Saving settings...').css('opacity', 1);
  });
  sendToServer({ req: 'settings', mode: 'get' });
  showModal('settings', div, true);
}
function handleSettings(settings) {
  $('#autosnap').prop('checked', settings.autosnap);
  $('#autoprune').prop('checked', settings.autoprune);
  $('#snapafter').val(settings.snapafter);
  $('#pruneafter').val(settings.pruneafter);
  $('#prunedays').val(settings.prunedays);
  $('#pruneweeks').val(settings.pruneweeks);
  $('#prunemonths').val(settings.prunemonths).trigger('input');
}

function loadSnapshots() {
  let div = $('<div><h1>Snapshots</h1><div id="modal-body"><ul id="snapshots">Loading...</ul></div><p><input type="button" id="create-snapshot" class="modal-button-small" value="Create new snapshot"></div>');
  div.find('#create-snapshot').on('click', function() {
    let note = app.notes[app.activenote];
    if (note.touched) return alert('Last changes not saved yet; please wait 10 seconds and try again');
    sendToServer({ req: 'snapshot', mode: 'add', note: app.activenote });
    $('#status').html('Saving snapshot...').css('opacity', 1);
  });
  div.find('#snapshots').on('click', 'LI', function(evt) {
    let li = $(evt.currentTarget);
    location.hash = '#' + app.activenote + '@' + li.data('modified');
    hideModal();
  });
  div.find('#snapshots').on('click', '.snap-action', function(evt) {
    let button = $(evt.currentTarget);
    let li = button.parent();
    if (button.hasClass('snap-unlock')) {
      button.removeClass('snap-unlock').addClass('snap-lock').prop('title', 'Lock');
      li.append('<div class="snap-action snap-delete" title="Delete"/>');
      sendToServer({ req: 'snapshot', mode: 'pin', snapshot: li.data('id'), value: 0 });
    }
    else if (button.hasClass('snap-lock')) {
      button.removeClass('snap-lock').addClass('snap-unlock').prop('title', 'Unlock');
      li.find('.snap-delete').remove();
      sendToServer({ req: 'snapshot', mode: 'pin', snapshot: li.data('id'), value: 1 });
    }
    else if (button.hasClass('snap-delete')) {
      if (!confirm('Are you sure you want to delete the snapshot ' + li.find('.snap-modified').text() + '?')) return false;
      sendToServer({ req: 'snapshot', mode: 'del', note: app.activenote, snapshot: li.data('id') });
      $('#status').html('Deleting snapshot...').css('opacity', 1);
      if (app.snap && (app.snap == li.data('modified'))) window.location = window.location.hash.split('@')[0];
    }
    return false;
  });
  sendToServer({ req: 'snapshot', mode: 'list', note: app.activenote });
  showModal('snapshots', div, true);
}

function showModal(type, content, escapable) {
  $('#button-' + type).addClass('button-active');
  app.modal = type;
  let modal = $('#modal-overlay');
  modal.empty().append(content).css({ backgroundColor: 'rgba(0,0,0,0.5)', pointerEvents: 'auto' });
  if (escapable) modal.on('click', function(evt) {
    if (evt.target == this) hideModal();
  });
  else modal.off('click');
}
function hideModal() {
  $('#button-' + app.modal).removeClass('button-active');
  app.modal = null;
  let modal = $('#modal-overlay');
  modal.empty().css({ backgroundColor: 'rgba(0,0,0,0)', pointerEvents: 'none' });
  modal.off('click');
}

function login(error, challenge) {
  let modal = $('#modal-overlay');
  let content = '<div><h2>Login with password</h2><p>Please enter your password</p><form><p><input type="password" id="password" class="input-password"></p>'
  content += '<p><input type="checkbox" id="remember"> Remember for this device</p>';
  content += '<p><input type="submit" id="login-pw" class="modal-button" value="Submit"></p></form><p id="modal-error"></p>';
  if (challenge) content += '<h2>Login with U2F key</h2><p><input type="button" id="login-u2f" class="modal-button" value="Activate key"></p>';
  content += '</div>';
  showModal('password', content, false);
  if (error) modal.find('#modal-error').html(error);
  modal.find('#login-pw').on('click', function() {
    let data = { req: 'init', password: modal.find('#password').val() };
    if (modal.find('#remember')[0].checked) data.remember = true;
    if (location.hash.match(/^#[0-9]+$/)) data.activenote = location.hash.substring(1);
    sendToServer(data);
    modal.empty();
    app.modal = null;
    $('#status').html('Loading...').css('opacity', 1);
    $('#tab-recent').prepend(app.loader);
  });
  modal.find('#login-u2f').on('click', function() {
    webauthnAuthenticate(challenge, function(success, info) {
      if (success) {
        sendToServer({ req: 'init', response: info });
        $('#modal-error').empty();
      }
      else $('#modal-error').html(info);
    });
  });
  modal.find('#password').focus();
}
function clear() {
  app.notes = [];
  app.graph.graph.clear();
  app.graph.refresh();
  $('#input').val(null).attr('disabled', true);
  $('#render').empty();
  $('#tab-recent').empty();
  $('#tab-pinned').empty();
  $('#search-results').empty();
  $('#scrolled').hide();
  $('.loader').detach();
}
function logout() {
  clear();
  showModal('logout', '<div><p>You have been logged out</p><p><input type="button" class="modal-button" value="Login" onclick="hideModal(); sendToServer({ req: \'init\' });"></p></div>', false);
}

$.fn.getCursorPosition = function() {
  let el = this.get(0);
  return { start: el.selectionStart, end: el.selectionEnd };
}
$.fn.setCursorPosition = function(start, end) {
  if (end === undefined) end = start;
  this.each(function(index, elem) {
    elem.setSelectionRange(start, end);
  });
  return this;
};
function selectText(el) {
  if (document.selection) {
    let range = document.body.createTextRange();
    range.moveToElementText(el);
    range.select();
  }
  else if (window.getSelection) {
    let range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
}

function drag(evt) {
  console.log('drag');
  let id = $(evt.target).data('id');
  evt.dataTransfer.setData("id", id);
  if (app.notes[id].pinned) evt.dataTransfer.setData("rank", app.notes[id].pinned);
}
function drop(evt) {
  console.log('drop', evt);
  console.log('rank', evt.dataTransfer.getData('rank'));
}
function allowDrop(evt) {
  evt.preventDefault();
}

Element.prototype.isInView = function(margin = 0) {
  let rect = this.getBoundingClientRect();
  return (rect.top >= margin &&
          rect.left >= margin &&
          rect.bottom <= window.innerHeight-margin &&
          rect.right <= window.innerWidth-margin);
}
Element.prototype.customScrollIntoView = function() {
  if ('scrollBehavior' in document.documentElement.style) {
    this.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  else this.scrollIntoView();
}

// WebAuthn support by David Earl - https://github.com/davidearl/webauthn/
function webauthnRegister(key, callback){
	key = JSON.parse(key);
	key.publicKey.attestation = undefined;
	key.publicKey.challenge = new Uint8Array(key.publicKey.challenge); // convert type for use by key
	key.publicKey.user.id = new Uint8Array(key.publicKey.user.id);

	navigator.credentials.create({publicKey: key.publicKey})
		.then(function (aNewCredentialInfo) {
			var cd = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(aNewCredentialInfo.response.clientDataJSON)));
			if (key.b64challenge != cd.challenge) {
				callback(false, 'key returned something unexpected (1)');
			}
			if ('https://'+key.publicKey.rp.name != cd.origin) {
				return callback(false, 'key returned something unexpected (2)');
			}
			if (! ('type' in cd)) {
				return callback(false, 'key returned something unexpected (3)');
			}
			if (cd.type != 'webauthn.create') {
				return callback(false, 'key returned something unexpected (4)');
			}

			var ao = [];
			(new Uint8Array(aNewCredentialInfo.response.attestationObject)).forEach(function(v){
				ao.push(v);
			});
			var rawId = [];
			(new Uint8Array(aNewCredentialInfo.rawId)).forEach(function(v){
				rawId.push(v);
			});
			var info = {
				rawId: rawId,
				id: aNewCredentialInfo.id,
				type: aNewCredentialInfo.type,
				response: {
					attestationObject: ao,
					clientDataJSON:
					  JSON.parse(String.fromCharCode.apply(null, new Uint8Array(aNewCredentialInfo.response.clientDataJSON)))
				}
			};
			callback(true, JSON.stringify(info));
		})
		.catch(function (aErr) {
			if (
				("name" in aErr) && (aErr.name == "AbortError" || aErr.name == "NS_ERROR_ABORT")
				|| aErr.name == 'NotAllowedError'
			) {
				callback(false, 'abort');
			} else {
				callback(false, aErr.toString());
			}
		});
}
function webauthnAuthenticate(key, cb){
	var pk = JSON.parse(key);
	var originalChallenge = pk.challenge;
	pk.challenge = new Uint8Array(pk.challenge);
	pk.allowCredentials.forEach(function(k, idx){
		pk.allowCredentials[idx].id = new Uint8Array(k.id);
	});
	navigator.credentials.get({publicKey: pk})
		.then(function(aAssertion) {
			var ida = [];
			(new Uint8Array(aAssertion.rawId)).forEach(function(v){ ida.push(v); });
			var cd = JSON.parse(String.fromCharCode.apply(null,
														  new Uint8Array(aAssertion.response.clientDataJSON)));
			var cda = [];
			(new Uint8Array(aAssertion.response.clientDataJSON)).forEach(function(v){ cda.push(v); });
			var ad = [];
			(new Uint8Array(aAssertion.response.authenticatorData)).forEach(function(v){ ad.push(v); });
			var sig = [];
			(new Uint8Array(aAssertion.response.signature)).forEach(function(v){ sig.push(v); });
			var info = {
				type: aAssertion.type,
				originalChallenge: originalChallenge,
				rawId: ida,
				response: {
					authenticatorData: ad,
					clientData: cd,
					clientDataJSONarray: cda,
					signature: sig
				}
			};
			cb(true, JSON.stringify(info));
		})
		.catch(function (aErr) {
			if (("name" in aErr) && (aErr.name == "AbortError" || aErr.name == "NS_ERROR_ABORT" ||
									 aErr.name == "NotAllowedError")) {
				cb(false, 'abort');
			} else {
				cb(false, aErr.toString());
			}
		});
}

// date.format library (https://github.com/jacwright/date.format) by Jacob Wright and others - MIT license
(function(){Date.shortMonths=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],Date.longMonths=["January","February","March","April","May","June","July","August","September","October","November","December"],Date.shortDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],Date.longDays=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];var t={d:function(){return(this.getDate()<10?"0":"")+this.getDate()},D:function(){return Date.shortDays[this.getDay()]},j:function(){return this.getDate()},l:function(){return Date.longDays[this.getDay()]},N:function(){return 0==this.getDay()?7:this.getDay()},S:function(){return this.getDate()%10==1&&11!=this.getDate()?"st":this.getDate()%10==2&&12!=this.getDate()?"nd":this.getDate()%10==3&&13!=this.getDate()?"rd":"th"},w:function(){return this.getDay()},z:function(){var t=new Date(this.getFullYear(),0,1);return Math.ceil((this-t)/864e5)},W:function(){var t=new Date(this.valueOf()),e=(this.getDay()+6)%7;t.setDate(t.getDate()-e+3);var n=t.valueOf();return t.setMonth(0,1),4!==t.getDay()&&t.setMonth(0,1+(4-t.getDay()+7)%7),1+Math.ceil((n-t)/6048e5)},F:function(){return Date.longMonths[this.getMonth()]},m:function(){return(this.getMonth()<9?"0":"")+(this.getMonth()+1)},M:function(){return Date.shortMonths[this.getMonth()]},n:function(){return this.getMonth()+1},t:function(){var t=this.getFullYear(),e=this.getMonth()+1;return 12===e&&(t=t++,e=0),new Date(t,e,0).getDate()},L:function(){var t=this.getFullYear();return t%400==0||t%100!=0&&t%4==0},o:function(){var t=new Date(this.valueOf());return t.setDate(t.getDate()-(this.getDay()+6)%7+3),t.getFullYear()},Y:function(){return this.getFullYear()},y:function(){return(""+this.getFullYear()).substring(2)},a:function(){return this.getHours()<12?"am":"pm"},A:function(){return this.getHours()<12?"AM":"PM"},B:function(){return Math.floor(1e3*((this.getUTCHours()+1)%24+this.getUTCMinutes()/60+this.getUTCSeconds()/3600)/24)},g:function(){return this.getHours()%12||12},G:function(){return this.getHours()},h:function(){return((this.getHours()%12||12)<10?"0":"")+(this.getHours()%12||12)},H:function(){return(this.getHours()<10?"0":"")+this.getHours()},i:function(){return(this.getMinutes()<10?"0":"")+this.getMinutes()},s:function(){return(this.getSeconds()<10?"0":"")+this.getSeconds()},u:function(){var t=this.getMilliseconds();return(10>t?"00":100>t?"0":"")+t},e:function(){return/\((.*)\)/.exec((new Date).toString())[1]},I:function(){for(var t=null,e=0;12>e;++e){var n=new Date(this.getFullYear(),e,1),i=n.getTimezoneOffset();if(null===t)t=i;else{if(t>i){t=i;break}if(i>t)break}}return this.getTimezoneOffset()==t|0},O:function(){return(-this.getTimezoneOffset()<0?"-":"+")+(Math.abs(this.getTimezoneOffset()/60)<10?"0":"")+Math.floor(Math.abs(this.getTimezoneOffset()/60))+(0==Math.abs(this.getTimezoneOffset()%60)?"00":(Math.abs(this.getTimezoneOffset()%60)<10?"0":"")+Math.abs(this.getTimezoneOffset()%60))},P:function(){return(-this.getTimezoneOffset()<0?"-":"+")+(Math.abs(this.getTimezoneOffset()/60)<10?"0":"")+Math.floor(Math.abs(this.getTimezoneOffset()/60))+":"+(0==Math.abs(this.getTimezoneOffset()%60)?"00":(Math.abs(this.getTimezoneOffset()%60)<10?"0":"")+Math.abs(this.getTimezoneOffset()%60))},T:function(){return this.toTimeString().replace(/^.+ \(?([^\)]+)\)?$/,"$1")},Z:function(){return 60*-this.getTimezoneOffset()},c:function(){return this.format("Y-m-d\\TH:i:sP")},r:function(){return this.toString()},U:function(){return this.getTime()/1e3}};Date.prototype.format=function(e){var n=this;return e.replace(/(\\?)(.)/g,function(e,i,r){return""===i&&t[r]?t[r].call(n):r})}}).call(this);

// String.startsWith polyfill to support IE11
if (!String.prototype.startsWith) { String.prototype.startsWith = function(searchString, position) { position = position || 0; return this.indexOf(searchString, position) === position; }; }
