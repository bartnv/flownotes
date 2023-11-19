'use strict';

let app = {
  init: false,
  mode: 'edit',
  activenote: null,
  snapshots: null,
  uploads: null,
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
  uploadqueue: [],
  loader: $('<div class="loader"><div></div><div></div><div></div><div></div></div>')
}

$(document).on('keydown', function(evt) {
  if (evt.key == 'F2') {
    return false;
  }
  else if (evt.key == 'F4') {
    if (app.mode == 'view') switchMode('edit');
    else switchMode('view');
    return false;
  }
  else if (evt.key == 'Escape') {
    if (app.modal && (app.modal != 'password')) hideModal();
    if (app.tour) {
      app.tourdiv.remove();
      delete app.tour;
      delete app.tourdiv;
    }
  }
  else if ((evt.key == 'ArrowLeft') && (app.tour)) {
    tourStep(true);
    return false;
  }
  else if ((evt.key == 'ArrowRight') && (app.tour)) {
    tourStep();
    return false;
  }
}).on('dragover', function(evt) {
  evt.preventDefault();
}).on('paste', function(evt) {
  let item = evt.originalEvent.clipboardData.items[0];
  if (item?.type.startsWith('image/')) {
    if (app.uploadqueue.length) {
      $('#status').text('Please wait for the previous upload to finish').css('opacity', 1);
      return;
    }
    let html = '<div id="upload"><h2>Upload files</h2><div id="upload-progress" class="nointeraction"><table></table></div></div>';
    showModal('paste-upload', html, true);
    app.uploadqueue.push(item.getAsFile());
    doUpload();
  }
});

$().ready(function() {
  let renderer = {
    link(href, title, text) {
      if (title == null) title = '';
      let match = href.match(/^#([0-9]+)/);
      if (match) {
        if (text.startsWith('=') && (text != '=')) title = text = text.substring(1);
        else if (app.notes[match[1]]) title = app.notes[match[1]].title;
        return '<a class="link-note" href="' + href + '" title="' + title + '">' + text + '</a>';
      }
      else if (href.match(/^#[A-Za-z -]+$/)) {
        if (text == '') {
          title = href.substring(1).toLowerCase();
          text = href.substring(1).replaceAll('-', ' ');
        }
        href = '#' + app.activenote + '_' + title;
        return '<a class="link-head" href="' + href + '" title="' + title + '">' + text + '</a>';
      }
      else if (href.match(/^uploads/)) {
        return '<a class="link-ext" href="data.php?upload=' + href.substring(8) + '" title="' + title + '" target="_blank">' + text + '</a>';
      }
      return '<a class="link-ext" href="' + href + '" title="' + title + '" target="_blank">' + text + '</a>';
    },
    image(href, title, text) {
      if (!title) title = text;
      if (href.match(/^uploads/)) {
        return '<img src="data.php?upload=' + href.substring(8) + '" alt="' + text + '" title="' + title + '" onclick="lightbox(this)">';
      }
      return '<img src="' + href + '" alt="' + text + '" title="' + title + '">';
    },
    code(code, info, escaped) {
      if (info) return '<pre data-info="' + info + '"><code>' + code + '</code></pre>';
      return '<pre><code>' + code + '</code></pre>';
    },
    codespan(code) {
      return '<code class="inline">' + code.replaceAll('&amp;', '&') + '</code>';
    }
  };
  let password = {
    name: 'password',
    level: 'inline',
    start(src) { let match = src.match(/\*`/); return match?match.index:undefined; },
    tokenizer(src) {
      let rule = /^\*`([^`]+)`/;
      let match = rule.exec(src);
      if (match) return { type: 'password', raw: match[0], pass: match[1] }
    },
    renderer(token) {
      return '<code class="inline" onclick="passwordToClipboard(this, event);" data-pass="' + token.pass + '">*****</code>';
    }
  };
  marked.use({
    breaks: true,
    renderer: renderer,
    extensions: [ password ]
  });

  $('#input').on('keydown', function(e) {
    if (!e.key.startsWith('F')) {
      e.stopPropagation();
      if (!app.changed) app.changed = Date.now();
    }

    if (app.prepended && (e.key != 'Enter') && (e.key != 'Backspace') && (e.key != ' ')) app.prepended = null;

    if (e.ctrlKey && (e.key == 'F1')) {
      let cursor = $('#input').getCursorPosition();
      let before = $('#input').val().substring(0, cursor.start);
      let after = $('#input').val().substring(cursor.end);
      let sep;
      if (before.slice(-2) == "\n\n") sep = '---';
      else if (before.slice(-1) == "\n") sep = '\n---';
      else sep = '\n\n---';
      let skip = sep.length+2;
      if (after.length == 0) sep += '\n\n';
      else if ((after.substring(0, 2) == "\n\n")); // Do nothing
      else if (after.substring(0, 1) == "\n") sep += '\n';
      else sep += '\n\n';
      $('#input').val(before + sep + after).setCursorPosition(cursor.start+skip);
      return false;
    }
    else if (e.key == 'F1') {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition();
      let newcontent = content.substring(0, cursor.start) + new Date().format('Y-m-d') + content.substring(cursor.end);
      $('#input').val(newcontent).setCursorPosition(cursor.start+10);
      return false;
    }
    else if (e.ctrlKey && (e.key == 'F2')) {
      let cursor = $('#input').getCursorPosition();
      let before = $('#input').val().substring(0, cursor.start);
      let after = $('#input').val().substring(cursor.end);
      let nostartsep = false;
      let start = before.lastIndexOf('\n---\n');
      if (start == -1) { start = before.indexOf('\n'); nostartsep = true; }
      if (start == -1) return false;
      start += 1;
      let end = after.indexOf('\n---\n');
      if (end == -1) end = before.length+after.length;
      else {
        end += before.length;
        if (nostartsep) end += 4;
        else end += 1;
      }
      $('#input').setCursorPosition(start, end);
      return false;
    }
    else if (e.key == 'F2') {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition();
      let newcontent = content.substring(0, cursor.start) + new Date().format('Y-m-d H:i') + content.substring(cursor.end);
      $('#input').val(newcontent).setCursorPosition(cursor.start+16);
      return false;
    }
    else if (e.ctrlKey && (e.key == 'Enter')) {
      app.addnote = 'link';
      sendToServer({ req: 'add', addlink: 'true', lastupdate: app.lastupdate });
      $('#status').html('Loading...').css('opacity', 1);
    }
    else if (e.altKey && (e.key == 'Enter')) {
      let input = $('#input')[0];
      cursorActivate(input.value, input.selectionStart);
    }
    else if (e.shiftKey && (e.key == 'Enter')) {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition();
      if (cursor.start == cursor.end) {
        alert("Moving a paragraph to a new note (shift+enter) requires selected text");
        return false;
      }
      let text = content.substring(cursor.start, cursor.end).replace(/^##/gm, '#');
      $('#input')
        .val(content.substring(0, cursor.start) + content.substring(cursor.end))
        .setCursorPosition(cursor.start);
      app.addnote = 'link';
      sendToServer({ req: 'add', addlink: 'true', content: text, lastupdate: app.lastupdate });
      $('#status').html('Loading...').css('opacity', 1);
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
      let cursor = $('#input').getCursorPosition(true);
      let startsel = content.lastIndexOf("\n", cursor.start-1)+1; // Start selection right after the last newline (or at 0 in case indexOf() returns -1)
      if (startsel == 0) return false; // Already at the first line
      let endsel = content.indexOf("\n", cursor.end-(cursor.start==cursor.end?0:1))+1;
      if (endsel == 0) { // No newline after the selection
        content += "\n";
        endsel = content.length;
      }
      let endpre = content.lastIndexOf("\n", startsel-2)+1;
      if ((endpre == 1) && (startsel == 1)) endpre = 0; // Empty first line
      let newcontent = content.substring(0, endpre) + content.substring(startsel, endsel) + content.substring(endpre, startsel) + content.substring(endsel);
      $('#input').val(newcontent).setCursorPosition(endpre+cursor.start-startsel, endpre+cursor.end-startsel).trigger('input');
      return false;
    }
    else if (e.ctrlKey && (e.key == 'ArrowDown')) {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition(true);
      let startsel = content.lastIndexOf("\n", cursor.start-1)+1;
      let endsel = content.indexOf("\n", cursor.end-(cursor.start==cursor.end?0:1))+1;
      if (endsel == 0) return false; // Already at the last line
      let startpost = content.indexOf("\n", endsel)+1;
      if (startpost == 0) startpost = content.length;
      if (endsel == startpost) return false; // Already at the last line
      let newcontent = content.substring(0, startsel) + content.substring(endsel, startpost) + content.substring(startsel, endsel) + content.substring(startpost);
      $('#input').val(newcontent).setCursorPosition(startsel+startpost-endsel+cursor.start-startsel, startsel+startpost-endsel+cursor.end-startsel).trigger('input');
      return false;
    }
    else if (e.ctrlKey && (e.key == '>')) {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition(true);
      if (cursor.start == cursor.end) {
        let start = content.lastIndexOf("\n", cursor.start-1);
        let newcontent = content.substring(0, start+1) + '> ' + content.substring(start+1);
        $('#input').val(newcontent).setCursorPosition(cursor.start+2).trigger('input');
      }
      else {
        let selection = content.substring(cursor.start, cursor.end-1).replace(/^/gm, '> ');
        let newcontent = content.substring(0, cursor.start) + selection + content.substring(cursor.end-1);
        $('#input').val(newcontent).setCursorPosition(cursor.start, cursor.end+(selection.length-(cursor.end-cursor.start)+1)).trigger('input');
      }
      return false;
    }
    else if (e.ctrlKey && (e.key == '<')) {
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition(true);
      if (cursor.start == cursor.end) {
        let start = content.lastIndexOf("\n", cursor.start-1);
        if (content.substring(start+1, start+3) == '> ') {
          let newcontent = content.substring(0, start+1) + content.substring(start+3);
          $('#input').val(newcontent).setCursorPosition(Math.max(cursor.start-2, start+1)).trigger('input');
        }
      }
      else {
        let selection = content.substring(cursor.start, cursor.end-1).replace(/^> /gm, '');
        let newcontent = content.substring(0, cursor.start) + selection + content.substring(cursor.end-1);
        $('#input').val(newcontent).setCursorPosition(cursor.start, cursor.end+(selection.length-(cursor.end-cursor.start)+1)).trigger('input');
      }
      return false;
    }
  }).on('input', function(e) {
    if (app.prepended) { // Previous keystroke prepended text
      let content = $('#input').val();
      let cursor = $('#input').getCursorPosition().start;
      let len = app.prepended.length;
      if (e.originalEvent.inputType == 'insertLineBreak') { // Enter pressed
        $('#input')
          .val(content.substring(0, cursor-len-1) + content.substring(cursor-1))
          .setCursorPosition(cursor-len);
      }
      else if (e.originalEvent.inputType == 'deleteContentBackward') { // Backspace pressed
        $('#input')
          .val(content.substring(0, cursor-len+1) + content.substring(cursor))
          .setCursorPosition(cursor-len+1);
      }
      else if ((e.originalEvent.inputType == 'insertText') && (e.originalEvent.data == ' ')) { // Spacebar pressed
        $('#input')
          .val(content.substring(0, cursor-len-1) + ' '.repeat(len) + content.substring(cursor))
          .setCursorPosition(cursor-1);
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
    if (!app.notes[app.activenote].touched) {
      app.notes[app.activenote].touched = true;
      $('.note-li[data-id=' + app.activenote + ']').addClass('note-touched');
      $('#button-mode-edit').addClass('button-touched');
    }
    else if (app.notes[app.activenote].content == $('#input').val()) {
      app.notes[app.activenote].touched = false;
      $('.note-li[data-id=' + app.activenote + ']').removeClass('note-touched');
      $('#button-mode-edit').removeClass('button-touched');
    }
    app.inactive = 0;
    // if (!app.offline && (app.lastcomm < Date.now()-90000)) $('#status').html('No communication with server; changes are not being saved').css('opacity', 1);
    updateStats();
  }).on('mouseup', function(evt) {
    if (evt.altKey && !evt.ctrlKey && !evt.shiftKey) {
      let input = $('#input')[0];
      cursorActivate(input.value, input.selectionStart);
    }
  });
  $('#panel-main').on('dragenter', function(evt) {
    let html = '<div id="upload"><h2>Upload files</h2><div id="upload-dropzone" droppable>';
    html += '<p class="nointeraction">Drop files here to upload them to FlowNotes</p>';
    html += '<div id="upload-progress" class="nointeraction"><table></table></div>';
    html += '</div></div>';
    showModal('upload', html, true);
    $('#upload').on('drop', function(evt) {
      evt.preventDefault();
      if (app.uploadqueue.length) {
        $('#status').text('Please wait for the previous upload to finish').css('opacity', 1);
        return;
      }
      for (let file of evt.originalEvent.dataTransfer.files) app.uploadqueue.push(file);
      doUpload();
    });
    $('#modal-overlay').one('dragleave', function(evt) {
      hideModal();
    });
  });
  $('#render').on('click', 'code', function (e) {
    if (!navigator.clipboard) return;
    if (window.getSelection().type == 'Range') return;
    navigator.clipboard.writeText($(this).text());
    selectText(this);
    showCopied(e);
  }).on('click', 'pre', function (e) {
    if (!navigator.clipboard) return;
    if (window.getSelection().type != 'Range') return;
    let sel = window.getSelection();
    if (sel.anchorNode !== sel.focusNode) return; // Selection continues outside of code block
    navigator.clipboard.writeText(sel.toString());
    showCopied(e);
  }).on('dblclick', 'pre', function() {
    this.contentEditable = true;
    selectText(this);
    if (navigator.clipboard) navigator.clipboard.writeText($(this).text());
    $(this).on('blur', function() {
      this.contentEditable = false;
    });
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
      if ($('#compare').is(':visible')) {
        $('#compare').hide();
        if (app.mode == 'edit') $('#input').show();
        else $('#render').show();
      }
      let id = parseInt(location.hash.substring(1), 10);
      if (id != app.activenote) activateNote(id);
      if (app.addnote) {
        app.addnote = null;
        if (app.mode == 'edit') $('#input').focus();
      }
      if (app.snap) {
        app.snap = null;
        loadNote(id);
      }
      return;
    }

    let match = location.hash.match(/^#([0-9]+)_(.*)$/);
    if (match) {
      let id = parseInt(match[1], 10);
      if (id != app.activenote) activateNote(id);
      if (app.mode != 'edit') return;
      if (!app.slugtoraw) return;
      let raw = app.slugtoraw[match[1] + '_' + match[2]];
      if (!raw) return;
      let input = $('#input');
      let idx = input.val().indexOf(raw);
      if (idx == -1) return;
      let end = idx+raw.length;
      let fulltext = input.val();
      input.val(fulltext.substring(0, end));
      let scrollheight = input[0].scrollHeight;
      input.val(fulltext);
      input.setCursorPosition(idx, idx+raw.length).focus();
      if (scrollheight > input[0].clientHeight) scrollheight -= input[0].clientHeight/2;
      else scrollheight = 0;
      input[0].scrollTop = scrollheight;
      return;
    }
    match = location.hash.match(/^#([0-9]+)@([0-9]+)$/);
    if (match) { // Showing snapshot
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
  }).on('unload', function() { // TODO: switch this over to visiblitychange/pagehide
    if (app.changed) {
      app.notes[app.activenote].content = $('#input').val();
      pushUpdate(true);
    }
    let instance = '-';
    instance += location.pathname.split('/').slice(1, -1).join('-');
    localStorage.setItem('flownotes' + instance + 'activenote', app.activenote);
    localStorage.setItem('flownotes' + instance + 'hidepanelleft', app.hidepanelleft);
    localStorage.setItem('flownotes' + instance + 'hidepanelright', app.hidepanelright);
    localStorage.setItem('flownotes' + instance + 'lastpanelright', app.lastpanelright);
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
    $(window).one('mousemove', function(evt) {
      $('body').addClass('dragging');
    });
    return false;
  }).on('keyup', 'a', function(evt) {
    if (evt.originalEvent.code == 'Space') this.click();
  });
  $('#input').on('mouseup', function() {
    if (app.prepended) app.prepended = null;
    let input = $(this);
    if (app.linkupload) {
      let content = input.val();
      let linkstr = '';
      if (app.linkupload.filetype.startsWith('image/')) linkstr += '!';
      if (this.selectionStart != this.selectionEnd) { // We have text selected, use as linktext
        linkstr += '[' + content.substring(this.selectionStart, this.selectionEnd) + '](uploads/' + app.linkupload.filename + ')';
      }
      else linkstr += '[' + app.linkupload.title + '](uploads/' + app.linkupload.filename + ')';
      let pos = this.selectionStart + linkstr.length;
      input.val(content.substring(0, this.selectionStart) + linkstr + content.substring(this.selectionEnd));
      this.setSelectionRange(pos, pos);
      app.changed = Date.now()-60000; // Force a pushUpdate on the next tick
      input.trigger('input');
      return;
    }
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
  $(window).on('mouseup', function(evt) {
    if (app.linkid) {
      let dropid = evt.target.dataset.id || evt.target.parentElement.dataset.id;
      if (dropid && (app.linkid != dropid) && $(evt.target).parents('#tab-pinned').length) {
        sendToServer({ req: 'pindrag', id: app.linkid, pinned: app.notes[dropid].pinned+1 });
      }
      $('.note-li[data-id="' + app.linkid + '"]').removeClass('note-selected');
      $('body').removeClass('dragging');
      $(window).off('mousemove');
      app.linkid = null;
    }
    else if (app.linkupload) {
      $('.note-selected').removeClass('note-selected');
      $('body').removeClass('dragging');
      $(window).off('mousemove');
      app.linkupload = null;
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
        updateLinks();
        break;
      case 'snaps':
        loadSnapshots();
        break;
      case 'toc':
        loadToc();
        break;
      case 'uploads':
        loadUploads();
        break;
    }
    $(this).addClass('button-active').siblings('.button-mode').removeClass('button-active');
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
    app.addnote = 'new';
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
    $('#panel-main')[0].requestFullscreen();
  });
  $('#button-popout').on('click', function() {
    let proxy = window.open('./popout.html', '_blank', 'popup,height=800,width=600');
    $(proxy).on('load', function() {
      let content;
      if (app.mode == 'edit') content = '<div id="input">' + $('#input').val().replaceAll(/&/g, '&amp;').replaceAll(/</g, '&lt;') + '</div>';
      else content = $('#render').clone();
      $(proxy.document.documentElement).find('body').append(content);
    });
  });
  $('#button-export').on('click', loadExports);
  $('#button-help').on('click', loadHelp);
  $('#button-settings').on('click', loadSettings);
  $('#button-snap-compare').on('click', function() {
    let snapshot = null;
    for (let snap of app.snapshots) {
      if (snap.modified == app.snap) {
        snapshot = snap;
        break;
      }
    }
    if (!snapshot) return console.error('Snapshot ' + app.snap + ' not found');
    let content = '<div>' + diffString(escape(snapshot.content), escape(app.notes[app.activenote].content)) + '</div>';
    $('#compare-from').html('<h1>Snapshot</h1>' + content);
    $('#compare-to').html('<h1>Current</h1>' + content);
    $('#input,#render,#stats,#link').hide();
    $('#compare').show();
  });
  $('#button-snap-close').on('click', function() {
    $('#compare').hide();
    if (app.mode == 'edit') $('#input').show();
    else $('#render').show();
    location.hash = '#' + app.activenote;
  });
  $('#button-snap-restore').on('click', function() {
    if (app.notes[app.activenote].modified > app.snapshots[app.snapshots.length-1].modified) {
      sendToServer({ req: 'snapshot', mode: 'add', activenote: app.activenote, locked: 0 });
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
    $('#compare').hide();
    if (app.mode == 'edit') $('#input').show();
    else $('#render').show();
    location.hash = '#' + note.id;
  });
  $('#tags').on('click', 'div', function(evt) {
    activateTab('search');
    $('#search-input').val(evt.currentTarget.innerHTML);
    $('#search-button').click();
  });
  $('#render').on('click', '.tag', function(evt) {
    activateTab('search');
    $('#search-input').val(evt.currentTarget.innerHTML);
    $('#search-button').click();
  });

  let instance = '-';
  instance += location.pathname.split('/').slice(1, -1).join('-');
  $('.sidepanel').addClass('notransition');
  if (localStorage.getItem('flownotes' + instance + 'hidepanelleft') == 'true') togglePanelLeft('close');
  if (localStorage.getItem('flownotes' + instance + 'hidepanelright') == 'false') {
    $('#button-' + localStorage.getItem('flownotes' + instance + 'lastpanelright')).click();
  }
  setTimeout(function() { $('.sidepanel').removeClass('notransition'); }, 500);

  init();

  console.log('Event handlers initialized; starting interval timer');
  setInterval(tick, 4000);
});

function init(data = {}) {
  data.req = 'init';
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
    let instance = '-';
    instance += location.pathname.split('/').slice(1, -1).join('-');
    if (location.hash.match(/^#[0-9]/)) {
      app.activenote = parseInt(location.hash.substring(1), 10);
      data.activenote = app.activenote;
    }
    else if (localStorage.getItem('flownotes' + instance + 'activenote')) {
      app.activenote = parseInt(localStorage.getItem('flownotes' + instance + 'activenote'), 10);
      data.activenote = app.activenote;
    }
    if (location.hash.indexOf('@') > -1) {
      app.snap = location.hash.substring(location.hash.indexOf('@')+1);
      data.snapshots = true;
    }
    if (location.hash == '#share') {
      app.returntoshare = true;
    }
    $('#tab-recent').append(app.loader);
  }
  if (!app.hidepanelright) {
    if (app.lastpanelright == 'snaps') data.snapshots = true;
    else if (app.lastpanelright == 'uploads') data.uploads = true;
  }
  sendToServer(data);
  $('#status').html('Loading...').css('opacity', 1);
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
    if ((window.innerWidth < 880) && !app.hidepanelleft) togglePanelLeft('close');
    $('#button-' + app.lastpanelright).addClass('button-active');
    updatePanels();
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
  render(app.notes[id].content);
  if (app.notes[id].mode && (app.mode != app.notes[id].mode)) switchMode(app.notes[id].mode);
  let active = $('#tab-recent .note-active')[0];
  if (active && !active.isInView()) active.customScrollIntoView();
  updatePublish(app.notes[id]);
  if (app.notes[id].tags) showTags(app.notes[id].tags);
  else $('#tags').hide();
  $('#snap').hide();
}
function loadSnap(snap) {
  if (app.mode == 'view') render(snap.content);
  $('#input').val(snap.content).attr('readonly', 'readonly');
  $('#snap').css('display', 'flex').find('#snapdate').text(dayjs.unix(snap.modified).format('YYYY-MM-DD HH:mm'));
  if (!app.hidepanelright && ($('#panel-main').width() == parseInt($('#panel-main').css('min-width')))) {
    togglePanelRight('close');
  }
}

function render(content) {
  let el = $('#render');
  content = content.replace(/^---\n(.*?)\n---/s, ''); // Remove Frontmatter
  content = content.replace(/\[( |x)\]/g, function(match, sub, offset) { // 2-step replace to avoid <input> being mangled, while recording a correct offset
    return '[' + sub + '][' + offset + ']';
  });
  content = content.replace(/&/g, '&amp;');
  content = content.replace(/</g, '&lt;');
  content = content.replace(/(?<=(^|\s))#[a-zA-Z][a-zA-Z0-9]+(?=(\s|$))/g, '<span class="tag">$&</span>');
  content = content.replace(/\[( |x)\]\[(\d+)\]/g, function(match, sub1, sub2, offset) {
    return '<input type="checkbox"' + (sub1 == 'x'?' checked':'') + ' onchange="checkboxChange(this, ' + sub2 + ')"></input>';
  });
  // marked.use({ headerPrefix: app.activenote + '_' });
  marked.use(markedGfmHeadingId.gfmHeadingId({ prefix: app.activenote + '_' }));
  el.html(marked.parse(content));
  return el;
}

function checkboxChange(checkbox, offset) {
  let input = $('#input');
  let content = input.val();
  if (checkbox.checked) input.val(content.substring(0, offset+1) + 'x' + content.substring(offset+2));
  else input.val(content.substring(0, offset+1) + ' ' + content.substring(offset+2));
  input.trigger('input');
}
function passwordToClipboard(el, evt) {
  if (!navigator.clipboard) return;
  navigator.clipboard.writeText($(el).data('pass'));
  selectText(el);
  showCopied(evt);
  evt.stopPropagation();
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
  if ((start != -1) && (end != -1)) { // Cursor is within a Markdown link
    let mid = line.indexOf('](');
    if (mid == -1) return;
    res = line.substring(mid+2, end);
  }
  else {
    start = line.lastIndexOf(' ', cursor);
    end = line.indexOf(' ', cursor);
    if (end == -1) end = line.length;
    res = line.substring(start+1, end);
    if (res.startsWith('(')) res = res.substring(1);
    if (res.endsWith(')')) res = res.substring(0, res.length-1);
  }

  if (res.substring(0, 1) == '#') window.location = res;
  else if (res.substring(0, 4) == 'http') window.open(res, '_blank', 'noopener');
  else if (res.substring(0, 8) == 'uploads/') window.open('data.php?upload=' + res.substring(8), '_blank');
}

function tick() {
  app.inactive++;
  if (!app.init) {
    return;
    // if (app.inactive%15 == 0) init();
  }
  else if (app.changed && ((app.inactive > 1) || (Date.now()-app.changed > 60000))) {
    app.changed = 0;
    let note = app.notes[app.activenote];
    if (note.touched) {
      note.content = $('#input').val();
      note.cursor = $('#input').getCursorPosition();
      note.title = findTitle(app.notes[app.activenote].content);
      note.tags = findTags(app.notes[app.activenote].content);
      if (note.tags) showTags(note.tags);
      render(note.content);
      if (($('#label-recent').hasClass('tab-active')) && ($('#tab-recent').prop('scrollTop') != 0) &&
          ($('#tab-recent .note-li[data-id="' + app.activenote + '"]').parent().index() != 0)) {
        $('#scrolled').click(); // Scroll updated note into view
      }
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
  else if (app.inactive%15 == 0) {
    sendToServer({ req: 'idle', lastupdate: app.lastupdate, activenote: app.activenote });
  }
}

function pushUpdate(beacon, retransmit) {
  let data = { req: 'update', activenote: app.activenote, notes: {}, lastupdate: app.lastupdate };
  if (!app.hidepanelright) {
    if (app.lastpanelright == 'snaps') data.snapshots = true;
    else if (app.lastpanelright == 'uploads') data.uploads = true;
  }
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
  if (beacon) {
    let blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    return navigator.sendBeacon('data.php', blob);
  }
  return $.post({ url: 'data.php', data: JSON.stringify(data), contentType: 'application/json' }).done(parseFromServer).fail(offline);
}
function parseFromServer(data, textStatus, xhr) {
  if (xhr.status != 200) return offline(xhr);
  if (data.error) return offline(data.error);
  if (data.alert) alert(data.alert);
  if (data.log) console.log(data.log);
  if (data.logout) return logout();
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
  if (data.templates) {
    loadTemplates(data.templates);
    $('.loader').detach();
    return;
  }

  if (app.returntoshare) window.history.go(-1);
  if (!app.init) app.init = true;

  if (data.modalerror) {
    let error = $('#modal-error');
    if (error.length) error.html(data.modalerror);
    else showModal('error', '<div><p id="modal-error">' + data.modalerror + '</p></div>', true);
  }
  if (data.settings == 'stored') hideModal();

  if ((data.snapshots) && (data.snapshotsfrom == app.activenote)) {
    app.snapshots = data.snapshots;
    if (app.hidepanelright == false && app.lastpanelright == 'snaps') updateSnapshots();
    if (window.location.hash.indexOf('@') > -1) $(window).trigger('hashchange');
  }
  if ((data.uploads) && (data.uploadsfrom == app.activenote)) {
    app.uploads = data.uploads;
    if (app.hidepanelright == false && app.lastpanelright == 'uploads') updateUploads();
  }

  if (data.notes) {
    for (let i in data.notes) {
      if (!app.notes[i]) app.notes[i] = { id: i };
      if (data.notes[i].title) app.notes[i].title = data.notes[i].title;
      if (data.notes[i].tags) app.notes[i].tags = data.notes[i].tags;
      else if (!app.notes[i].title) app.notes[i].title = '{no title}';
      if (data.notes[i].modified) {
        app.notes[i].modified = data.notes[i].modified;
        if (app.notes[i].intransit) {
          delete app.notes[i].intransit;
          if (!app.notes[i].touched) $('#button-mode-edit').removeClass('button-touched');
        }
      }
      if (data.notes[i].pinned) {
        app.notes[i].pinned = parseInt(data.notes[i].pinned);
        if (i == app.activenote) {
          if (app.notes[i].pinned) $('#button-note-pin').addClass('button-active').attr('title', 'Unpin note');
          else $('#button-note-pin').removeClass('button-active').attr('title', 'Pin note');
        }
      }
      if (data.notes[i].deleted == 1) app.notes[i].deleted = true;
      else app.notes[i].deleted = false;
      if (data.notes[i].flinks !== undefined) app.notes[i].flinks = data.notes[i].flinks;
      if (data.notes[i].blinks !== undefined) app.notes[i].blinks = data.notes[i].blinks;
      if (data.notes[i].cursor) {
        let pos = data.notes[i].cursor.split(',');
        app.notes[i].cursor = { start: pos[0], end: pos[1] };
      }
      if (data.notes[i].published !== undefined) {
        app.notes[i].published = data.notes[i].published;
        if (i == app.activenote) updatePublish(app.notes[i]);
      }
      if (!app.notes[i].mode) app.notes[i].mode = data.notes[i].mode;

      if ((data.notes[i].content !== undefined) && (app.notes[i].content !== data.notes[i].content)) {
        app.notes[i].content = data.notes[i].content;
        if ((i == app.activenote) && !app.notes[app.activenote].touched && !app.snap) {
          loadNote(app.activenote);
          if ($('#stats').is(':visible')) updateStats();
        }
      }
    }
    if (data.recent) app.recent = data.recent;
    updatePanels();
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
    if (app.addnote == 'link') { // New note created with ctrl+enter or shift+enter
      let input = $('#input')[0];
      let start = input.selectionStart;
      let end = input.selectionEnd;
      let val = input.value;
      let name;
      if (start != end) { // There is a text selection; use it as link text
        name = val.substring(start, end);
        app.notes[data.switchnote].title = findTitle(name);
        app.notes[data.switchnote].content = '# ' + name + '\n\n';
        app.notes[data.switchnote].touched = true;
      }
      else if (app.notes[data.switchnote].title) { // Used for shift+enter function
        name = '=' + app.notes[data.switchnote].title;
      }
      let link = '[' + name + '](#' + data.switchnote + ')';
      input.value = val.substring(0, start) + link + val.substring(end);
      input.setSelectionRange(start+1, start+1+name.length);
      app.notes[app.activenote].content = input.value;
      app.notes[app.activenote].cursor = { start: input.selectionStart, end: input.selectionEnd };
      app.notes[app.activenote].touched = true;
      pushUpdate();
    }
    location.hash = '#'+data.switchnote;
  }
}
function offline(msg = 'Connection failed, switching to offline mode') {
  if (typeof msg != 'string') {
    if (msg.status) msg = 'Error from server: ' + msg.status + ' (' + msg.statusText + ')';
    else msg = 'Network connection lost';
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
    // else $('#status').html('Offline mode').css('opacity', 1);
  }
  if (app.notes[app.activenote] && (app.notes[app.activenote].content === undefined)) {
    $('#input').val('');
    $('#render').empty();
  }
}

function updatePublish(note) {
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
        let name = prompt('Enter a name for this key');
        sendToServer({ req: 'webauthn', mode: 'register', response: info, name: name });
        showModal('webauthn', '<div><h2>Please wait...</h2><p>Registering U2F key on the server</p></div>', false);
      }
      else showModal('error', '<div><p id="modal-error" style="display: block;">Error registering U2F key: ' + info + '</p><p><input type="button" class="modal-button" value="Continue" onclick="loadSettings();"></p></div>', true);
    });
  }
  else if (data.webauthn == 'registered') loadSettings();
  else if (data.webauthn == 'list') {
    let str = '';
    for (let i in data.keys) {
      str += '<li>' + data.keys[i];
      str += ' <div class="webauthn-delete" onclick="if (confirm(\'Are you sure you want to delete ' + data.keys[i] + '?\')) deleteWebauthn(' + i + ')"></div>';
    }
    $('ul#list-u2f').html(str);
  }
}
function deleteWebauthn(idx) {
  sendToServer({ req: 'webauthn', mode: 'delete', idx: idx });
}

function switchMode(newmode) {
  let pct = NaN;
  app.prev = app.mode;
  app.mode = newmode;
  if (app.notes[app.activenote]) {
    if (!app.changed) app.changed = Date.now();
    app.notes[app.activenote].mode = newmode;
    app.notes[app.activenote].metatouched = true;
    if (app.notes[app.activenote].touched) render($('#input').val());
  }
  if (app.mode == 'edit') {
    if (app.prev == 'view') pct = $('#render').getScrolledPct();
    $('#render').hide();
    $('#input').show().focus();
    if (!isNaN(pct)) $('#input').setScrolledPct(pct);
  }
  else if (app.mode == 'view') {
    if (app.prev == 'edit') pct = $('#input').getScrolledPct();
    $('#input,#stats').hide();
    $('#render').show();
    if (!isNaN(pct)) $('#render').setScrolledPct(pct);
  }
  $('#button-mode-' + app.mode).addClass('button-active').siblings('.button-mode').removeClass('button-active');
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
      case 'snaps':
        updateSnapshots();
        break;
      case 'toc':
        loadToc();
        break;
      case 'uploads':
        updateUploads();
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
    if (note.touched || (note.intransit == 'full')) extraclass += ' note-touched';
    str += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '" data-id="' + note.id + '"><span class="note-title">' + note.title + '</span><br>';
    let modified = dayjs.unix(note.modified);
    str += '<span class="note-modified" title="Note saved at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">edited ' + modified.calendar() + '</span></div></a>';
    if (++count >= app.recent) break;
  }
  $('#tab-recent').html(str);
}
function updateSearch() {
  let items = app.searchresults;
  if (!items) return;
  items.sort(function(a, b) { return b[1] - a[1] });
  let results = "";
  for (let i of items) { // i is an array of [ id, hits ]
    if (i[1] === 0) continue; // FTS can sometimes result hits of 0
    if (i[1] === -1) i[1] = ''; // -1 is returned when the number of hits is irrelevant
    let note = app.notes[i[0]];
    let extraclass = '';
    if (note.id == app.activenote) extraclass = ' note-active';
    if (note.touched || (note.intransit == 'full')) extraclass += ' note-touched';
    if (note.deleted) extraclass += ' note-deleted';
    results += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '" data-id="' + note.id + '"><span class="note-title">' + note.title + '</span><br>';
    let modified = dayjs.unix(note.modified);
    results += '<span class="note-modified" title="Note saved at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">edited ' + modified.calendar() + '</span><span class="note-hits">' + i[1] + '</span></div></a>';
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
    if (note.touched || (note.intransit == 'full')) extraclass += ' note-touched';
    if (note.deleted) extraclass += ' note-deleted';
    pinned += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '" data-id="' + note.id + '">';
    pinned += '<span class="note-title">' + note.title + '</span><br>';
    pinned += '<div class="button-unpin" onclick="unpinNote(' + note.id + '); return false;" title="Unpin"></div>';
    let modified = dayjs.unix(note.modified);
    pinned += '<span class="note-modified" title="Note saved at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">edited ' + modified.calendar() + '</span></div></a>';
  }
  $('#tab-pinned').empty().html(pinned);
}
function updateLinks() {
  let note = app.notes[app.activenote];
  if (!note) return;
  let str = '<div class="list-divider">Links to this note</div><div id="links-to">';
  if (note.blinks) {
    for (let blink of note.blinks) {
      let classes = 'note-li';
      if (blink.deleted == 1) classes += ' note-deleted';
      str += '<a href="#' + blink.id + '"><div class="' + classes + '" data-id="' + blink.id + '">';
      str += '<span class="note-title">' + blink.title + '</span><br>';
      let modified = dayjs.unix(blink.modified);
      str += '<span class="note-modified" title="Note saved at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">edited ' + modified.calendar() + '</span></div></a>';
    }
  }
  else str += '<div class="list-none">- none -</div>';
  str += '</div><div class="list-divider">Links from this note</div><div id="links-from">';
  if (note.flinks) {
    for (let flink of note.flinks) {
      let classes = 'note-li';
      if (flink.deleted == 1) classes += ' note-deleted';
      str += '<a href="#' + flink.id + '"><div class="' + classes + '" data-id="' + flink.id + '">';
      str += '<span class="note-title">' + flink.title + '</span><br>';
      let modified = dayjs.unix(flink.modified);
      str += '<span class="note-modified" title="Note saved at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">edited ' + modified.calendar() + '</span></div></a>';
    }
  }
  else str += '<div class="list-none">- none -</div>';
  str += '</div>';
  $('#tab-right').html(str);
}
function updateSnapshots() {
  let div = $('#snapshots').empty();
  if (!div.length || !app.snapshots) return;
  if (!app.snapshots.length) {
    $('#snapshots').append('<div class="list-none">- none -</div>');
    return;
  }
  for (let snap of app.snapshots) {
    let str = '<div class="snap-li" data-id="' + snap.id + '" data-modified="' + snap.modified + '">';
    str += '<span class="snap-title">' + snap.title + '</span><br>';
    let modified = dayjs.unix(snap.modified);
    str += '<span class="snap-modified" title="Snapshot saved at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">saved ' + modified.calendar() + '</span><br>';
    let matches = snap.content.match(/\W\w/g);
    str += '<span class="snap-stats">chars: ' + snap.content.length + ' / words: ' + ((matches?matches:[]).length+(/^(\W|$)/.test(snap.content)?0:1)) + '</span>';
    if (snap.locked == 1) str += '<div class="snap-action snap-unlock" title="Unlock"></div>';
    else str += '<div class="snap-action snap-lock" title="Lock"></div><div class="snap-action snap-delete" title="Delete"></div>';
    str += '</div>';
    div.append(str);
  }
}
function loadUploads() {
  let div = $('#tab-right').empty()
    .append('<div class="list-divider">Files linked to this note</div><div id="uploads-linked" class="scrolly"></div><div class="list-divider mta">Unlinked files</div><div id="uploads-unlinked" class="scrolly"></div>');
  let linked = div.find('#uploads-linked');
  let unlinked = div.find('#uploads-unlinked');

  $(linked).add(unlinked).on('click', '.upload-li', function(evt) {
    if (evt.target.nodeName == 'A') return;
    let upload = $(evt.currentTarget);
    window.open('data.php?upload=' + upload.data('filename'), '_blank');
  });
  $(unlinked).on('click', '.upload-delete', function() {
    let upload = $(this).parent();
    if (confirm("Are you sure you want to permanently delete " + upload.data('title') + "?")) {
      sendToServer({ req: 'upload', mode: 'del', id: upload.data('id'), activenote: app.activenote });
      upload.remove();
    }
    return false;
  });
  $(linked).on('mousedown', function() { return false; });
  $(unlinked).on('mousedown', '.upload-li', function (evt) {
    let upload = $(evt.currentTarget).addClass('note-selected');
    app.linkupload = upload.data();
    $(window).one('mousemove', function(evt) {
      $('body').addClass('dragging');
    });
    return false;
  });
  if (app.uploads) updateUploads();
  else if (app.init) sendToServer({ req: 'upload', mode: 'list', activenote: app.activenote });
}

function updateUploads() {
  let linked = $('#uploads-linked').empty();
  let unlinked = $('#uploads-unlinked').empty();
  if (!app.uploads) return;

  if (!app.uploads.linked?.length) linked.append('<div class="list-none">- none -</div>');
  else {
    for (let upload of app.uploads.linked) {
      let str = '<div class="upload-li" data-id="' + upload.id + '" data-title="' + upload.title + '" data-filename="' + upload.filename + '">';
      str += '<span class="upload-title">' + upload.title + '</span><br>';
      if (upload.modified) {
        let modified = dayjs.unix(upload.modified);
        str += '<span class="upload-modified" title="File uploaded at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">uploaded ' + modified.calendar() + '</span><br>';
      }
      else str += '<span class="upload-modified">⚠ file not found in uploads folder ⚠</span><br>'
      str += '</div>';
      linked.append(str);
    }
  }

  if (!app.uploads.unlinked?.length) unlinked.append('<div class="list-none">- none -</div>');
  else {
    for (let upload of app.uploads.unlinked) {
      let str = '<div class="upload-li" data-id="' + upload.id + '" data-title="' + upload.title + '" data-filename="' + upload.filename + '" data-filetype="' + upload.filetype + '">';
      str += '<span class="upload-title">' + upload.title + '</span><br>';
      if (upload.modified) {
        let modified = dayjs.unix(upload.modified);
        str += '<span class="upload-modified" title="File uploaded at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">uploaded ' + modified.calendar() + '</span><br>';
      }
      else str += '<span class="upload-modified">⚠ file not found in uploads folder ⚠</span><br>'
      let modified = dayjs.unix(upload.unlinked);
      if (upload.note) {
        let a = '<a href="./#' + upload.note + '" title="' + app.notes[upload.note]?.title + '">#' + upload.note + '</a>';
        str += '<span class="upload-modified" title="File unlinked at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">unlinked from ' + a + ' ' + modified.calendar() + '</span>';
      }
      else str += '<span class="upload-modified" title="File discovered at ' + modified.format('YYYY-MM-DD HH:mm:ss') + '">discovered in uploads ' + modified.calendar() + '</span>';
      str += '<div class="upload-action upload-delete" title="Delete"></div>';
      str += '</div>';
      unlinked.append(str);
    }
  }
}

function findTitle(text) {
  let matches;
  if (matches = text.match(/^---\n(.*?)\n---/s)) { // Note has Frontmatter
    text = text.substring(matches[0].length);
    try {
      let fm = jsyaml.load(matches[1]);
      if (fm.title) return fm.title;
    } catch (e) {
      console.log('Failed to parse Frontmatter as YAML:', e.reason);
    }
  }
  matches = text.substring(0, 100).match(/([a-zA-Z\u00C0-\u024F0-9][a-zA-Z\u00C0-\u024F0-9 .\/\\'&():-]+[a-zA-Z\u00C0-\u024F0-9)])/mg);
  if (matches) {
    if (((matches[0] == 'http') || (matches[0] == 'https')) && matches[1]) return matches[1];
    return matches[0];
  }
  return '{no title}';
}

function findTags(text) {
  let tags = [];
  let matches;
  if (matches = text.match(/^---\n(.*?)\n---/s)) { // Note has Frontmatter
    text = text.substring(matches[0].length);
    try {
      let fm = jsyaml.load(matches[1]);
      if (Array.isArray(fm.tags)) {
        for (let tag of fm.tags) {
          if (typeof tag === 'string') tags.push(tag);
        }
      }
    } catch (e) {
      console.log('Failed to parse Frontmatter as YAML:', e.reason);
    }
  }
  matches = text.match(/(?<=(^|\s)#)[a-zA-Z][a-zA-Z0-9]+(?=(\s|$))/g);
  if (matches) tags = tags.concat(matches);
  return tags;
}

function showTags(tags) {
  let str = '';
  for (let tag of tags) {
    str += '<div>#' + tag + '</div>';
  }
  $('#tags').html(str).show();
}

function activateNote(id, nopost) {
  if (app.notes[app.activenote] && app.notes[app.activenote].touched) {
    app.notes[app.activenote].content = $('#input').val();
    app.notes[app.activenote].title = findTitle(app.notes[app.activenote].content);
    app.notes[app.activenote].tags = findTags(app.notes[app.activenote].content);
  }
  app.activenote = id;
  app.snapshots = null;
  app.uploads = null;
  $('.note-li').removeClass('note-active');
  $('a[href="#' + app.activenote + '"]').children().addClass('note-active');
  if (app.notes[id] && (app.notes[id].touched || (app.notes[id].intransit == 'full'))) $('#button-mode-edit').addClass('button-touched');
  else $('#button-mode-edit').removeClass('button-touched');
  $('#stats').hide();
  if (!nopost) {
    let data = { req: 'activate', activenote: app.activenote, lastupdate: app.lastupdate };
    if (!app.hidepanelright) {
      if (app.lastpanelright == 'snaps') data.snapshots = true;
      else if (app.lastpanelright == 'uploads') data.uploads = true;
    }
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
    // setTimeout(idle, 8000);
  }
  if (!app.hidepanelleft && ($('#panel-main').width() == parseInt($('#panel-main').css('min-width')))) {
    togglePanelLeft('close');
  }
  if (!app.hidepanelright && ($('#panel-main').width() == parseInt($('#panel-main').css('min-width')))) {
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
  if (items.error) {
    $('#search-results').empty().append('<div style="margin: 5px">Search error: ' + items.error + '</div>');
    return;
  }
  app.searchresults = items;
  updateSearch();
  if (first && (items.length == 1)) {
    location.hash = '#' + items[0][0];
    setTimeout("$('#search-input').focus();", 100);
  }
}

function loadExports() {
  let div = $('<div><h1>Export functions</h1><div id="modal-body"></div></div>');
  let body = div.find('#modal-body');
  body.append('<p><input type="button" id="export-get-html-one" class="modal-button-small" value="Download current note as HTML"></p>');
  body.append('<p><input type="button" id="export-get-txt-all" class="modal-button-small" value="Download all notes as plain text (ZIP)"></p>');
  body.append('<p><input type="button" id="export-get-html-all" class="modal-button-small" value="Download all notes as HTML (ZIP)"></p>');
  body.append('<p><input type="button" id="export-get-uploads" class="modal-button-small" value="Download all uploaded files (ZIP)"></p>');
  body.append('<p><input type="button" id="export-get-database" class="modal-button-small" value="Download FlowNotes database (SQLite)"></p>');
  body.append('<p><input type="button" id="export-pub-html-one" class="modal-button-small" value="Publish current note as HTML"></p>');
  body.append('<p><input type="button" id="export-pub-frag-one" class="modal-button-small" value="Publish current note as HTML fragment"></p>');
  body.find('#export-get-html-one').on('click', function() { window.location = 'data.php?export=htmlone&note=' + app.activenote; });
  body.find('#export-get-txt-all').on('click', function() { window.location = 'data.php?export=txtall'; });
  body.find('#export-get-html-all').on('click', function() { window.location = 'data.php?export=htmlall'; });
  body.find('#export-get-uploads').on('click', function() { window.location = 'data.php?export=uploads'; });
  body.find('#export-get-database').on('click', function() { window.location = 'data.php?export=database'; });
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

function loadTemplates(templates) {
  let div = $('<div><h1>Create new note</h1><div id="modal-body"></div></div>');
  let body = div.find('#modal-body');
  body.append('<p><input type="button" id="template-0" class="modal-button-small" value="New empty note"></p>');
  body.append('<h2>New note from template:</h2>');
  for (let template of templates) {
    body.append('<p><input type="button" id="template-' + template[0] + '" class="modal-button-small" value="' + template[1] + '"></p>');
  }
  body.on('click', '.modal-button-small', function() {
    app.addnote = 'template';
    sendToServer({ req: 'add', template: this.id.split('-')[1], lastupdate: app.lastupdate });
    hideModal();
  });
  showModal('templates', div, true);
}

function tourStep(back = false) {
  if (!app.tour) app.tour = 1;
  else if (back) app.tour--;
  else app.tour++;

  let tour = [
    null,
    [ 'Left sidebar', '#button-panel-left-hide', 'top', 'left', null,
      "With this button you can show or hide the left sidebar. This sidebar helps you find your notes. On a touchscreen, you can also swipe to the right to open it and to the left to close it." ],
    [ 'Recent notes', '#label-recent', 'top', 'left', function() { togglePanelLeft('open'); },
      "This list shows your notes in chronological order, with the most recent ones on top. You can scroll back as far as you need to. When you update an older note you'll notice it jumps to the top of the list as soon as it's saved." ],
    [ 'Search notes', '#label-search', 'top', 'left', null,
      "On this tab you can search through your notes. The full text of the notes is searched and all notes with your term in it will be returned. More complex selections are possible with Regular Expressions by starting the search with a forward slash." ],
    [ 'Pinned notes', '#label-pinned', 'top', 'left', function() { togglePanelLeft('open'); },
      'This tab shows your pinned notes. You can click the pin button to add to or remove from this list. This way you can keep your most-used notes close at hand.' ],
    [ 'Right sidebar', '#button-panel-right-hide', 'top', 'right', function() { togglePanelLeft('close'); },
      'Show or hide the right sidebar. This sidebar provides some miscellaneous functionality, such as an overview of links from/to the current note and a list of its snapshots.' ],
    [ 'Links', '#button-links', 'top', 'right', function() { $('#button-links').click(); },
      'This shows an overview of all notes that link to the current one and all notes the current one links to.' ],
    [ 'Snapshots', '#button-snaps', 'top', 'right', function() { $('#button-snaps').click(); },
      'This shows a list of the previously created snapshots for the current note (you can configure the automatic creation of snapshots in the settings). You can also make a new snapshot manually.' ],
    [ 'Headings', '#button-toc', 'top', 'right', function() { $('#button-toc').click(); },
      'This shows a table of contents based on Markdown headings you may have used in the note.' ],
    [ 'Uploads', '#button-uploads', 'top', 'right', function() { $('#button-uploads').click(); },
      'This shows the uploaded files that are linked to this note as well as, at the bottom, any files that are present in FlowNotes but not currently linked to a note.' ],
    [ 'Export functions', '#button-export', 'bottom', 'right', function() { togglePanelRight('close'); },
      'Here you find a set of export functions to use your notes in other applications. You can download a copy of your notes or publish an continously updated version as a public link.' ],
    [ 'Settings', '#button-settings', 'bottom', 'left', null,
      'In the settings panel you can manage security for your FlowNotes and configure things like snapshots and the share-to-FlowNotes functionality.' ]
  ];
  if (tour[app.tour]) {
    if (app.tourdiv) app.tourdiv.css('opacity', '0');
    if (tour[app.tour][4]) tour[app.tour][4]();
    setTimeout(function() { tourShow(tour[app.tour]); }, 350);
  }
  else {
    app.tourdiv.remove();
    delete app.tour;
    delete app.tourdiv;
  }
}
function tourShow(step) {
  if (!app.tourdiv) {
    app.tourdiv = $('<div id="tour-bubble"></div>');
    app.tourdiv.on('click', function(evt) { return false; });
  }
  app.tourdiv.empty().removeAttr('style').removeClass().addClass(step[2] + '-' + step[3]);
  app.tourdiv.append('<h2>' + step[0] + '</h2><p>' + step[5] + '</p>');
  app.tourdiv.append('<input type="button" class="modal-button" value="Prev" onclick="tourStep(true); event.cancelBubble = true;">');
  app.tourdiv.append('<input type="button" class="modal-button" value="Next" onclick="tourStep(); event.cancelBubble = true;">');
  if (step[2] == 'top') app.tourdiv.css('top', $(step[1]).height() + 'px');
  else app.tourdiv.css('bottom', $(step[1]).height() + 'px');
  if (step[3] == 'left') app.tourdiv.css('left', $(step[1]).width() + 'px');
  else app.tourdiv.css('right', $(step[1]).width() + 'px');
  app.tourdiv.css('border-' + step[2] + '-' + step[3] + '-radius', '0');
  $('#tour-arrow').removeAttr('style').css(step[2], '0').css(step[3], '0');
  $('.tour-anchor').removeClass('tour-anchor');
  $(step[1]).addClass('tour-anchor').append(app.tourdiv);
}

function loadHelp() {
  let div = $('<div><h1>Help</h1><div id="modal-body"></div><p><input type="button" class="modal-button" value="Close"></p></div>');
  let body = div.find('#modal-body');
  body.append('<p><input type="button" id="start-tour" class="modal-button-small" value="Start tour of application"></p>');
  body.append('<h2>Hotkeys</h2>');
  body.append('<p><em>R / S / P</em>: Switch to Recent, Search or Pinned tab respectively</p>');
  body.append('<p><em>N</em>: add a new note</p>');
  body.append('<p><em>F1</em>: insert the current date at the cursor position</p>');
  body.append('<p><em>F2</em>: insert the current date and time at the cursor position</p>');
  body.append('<p><em>F4</em>: switch between edit mode and view mode</p>');
  body.append('<p><em>CTRL+F1</em>: insert a divider at the cursor position</p>');
  body.append('<p><em>CTRL+F2</em>: select text between nearest two dividers</p>');
  body.append('<p><em>CTRL+Enter</em>: create new note and link to it at the cursor position</p>');
  body.append('<p><em>SHIFT+Enter</em>: create new note and move currently selected text to it</p>');
  body.append('<p><em>CTRL+ArrowUp</em>: move selected text one line up</p>');
  body.append('<p><em>CTRL+ArrowDown</em>: move selected text one line down</p>');
  body.append('<p><em>CTRL+&gt;</em>: increase blockquote indentation level for selected text</p>');
  body.append('<p><em>CTRL+&lt;</em>: decrease blockquote indentation level for selected text</p>');
  body.append('<p><em>ALT+Enter</em>: in edit mode: follow the link at the cursor position</p>');
  body.append('<p><em>ALT+Click</em>: in edit mode: follow the link at the clicked location</p>');
  body.append('<p><em>ALT+ArrowLeft</em>: go back a page (actually a browser hotkey)</p>');
  body.append('<p><em>ALT+ArrowRight</em>: go forward a page (actually a browser hotkey)</p>');
  body.append('<h2>Gestures</h2>');
  body.append('<p><em>Swipe left/right on sidebar</em>: open/close the sidebar');
  body.append('<p><em>Drag note onto edit field</em>: create link to the note');
  body.find('#start-tour').on('click', function() { hideModal(); tourStep(); });
  div.find('.modal-button').on('click', hideModal);
  showModal('help', div, true);
}

function loadSettings() {
  let div = $('<div><h1>Settings</h1><div id="modal-body"></div></div>');
  let body = div.find('#modal-body');
  body.append('<h2>Logout</h2>');
  body.append('<p><input type="button" id="logout-this" class="modal-button-small" value="Logout this session"></p>');
  body.append('<p><input type="button" id="logout-all" class="modal-button-small" value="Logout all sessions"> <span id="token-list">🛈</span></p>');
  body.append('<h2>Password</h2>');
  if (app.password) body.append('<p><span class="settings-label">Current password:</span><input type="password" class="input-password" name="old" autocomplete="current-password"></p>');
  body.append('<p><span class="settings-label">New password:</span><input type="password" class="input-password" name="new1" autocomplete="new-password"></p>');
  body.append('<p><span class="settings-label">Repeat new:</span><input type="password" class="input-password" name="new2" autocomplete="new-password"></p>');
  body.append('<h2>Security keys</h2>');
  body.append('<ul id="list-u2f">Loading...</ul>');
  body.append('<p><input type="button" id="register-u2f" class="modal-button-small" value="Register new U2F key"></p>');
  body.append('<h2>Automatic snapshots</h2>');
  body.append('<p><input type="checkbox" id="autosnap"> When editing, auto-snapshot every <input id="snapafter" class="input-smallint" type="number" min="1"> hours</p>');
  body.append('<p><input type="checkbox" id="autoprune"> Prune automatic snapshots after <input id="pruneafter" class="input-smallint" type="number" min="1"> days, keeping<br>snapshots <input id="prunedays" class="input-smallint" type="number" min="0"> days, <input id="pruneweeks" class="input-smallint" type="number" min="0"> weeks and <input id="prunemonths" class="input-smallint" type="number" min="0"> months apart');
  body.append('<h2>File uploads</h2>');
  body.append('<p><input type="checkbox" id="autodelete"> Delete unlinked file uploads after <input id="deleteafter" class="input-smallint" type="number" min="1" value="30"> days</p>');
  body.append('<p>Statistics: <span id="uploadstats">(loading)</span>');
  body.append('<h2>Share to FlowNotes</h2>');
  body.append('<p><span class="settings-label">Append-to note IDs:</span><input type="text" id="shareappend" placeholder="7,12,45" pattern="[0-9]+(, ?[0-9]+)*"></p>');
  body.append('<h2>New note templates</h2>');
  body.append('<p><span class="settings-label">Template note IDs:</span><input type="text" id="templatenotes" placeholder="2,8,16" pattern="[0-9]+(, ?[0-9]+)*"></p>');
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
  body.find('#token-list').attr('title', 'This function also invalidates all "Remember this device" tokens.');
  body.find('#register-u2f').on('click', function() {
    if (!app.password) return alert('Security keys can only be used with a password set. Please add a password first.');
    sendToServer({ req: 'webauthn', mode: 'prepare' });
  });
  div.find('#settings-save').on('click', function() {
    let data = { req: 'settings', mode: 'save' };
    let old = body.find('input[name=old]');
    let new1 = body.find('input[name=new1]');
    let new2 = body.find('input[name=new2]');
    if (new1.val().length || new2.val().length || (old.length && old.val().length)) {
      if (new1.val() != new2.val()) {
        div.find('#modal-error').show().html('Please verify your new password entries');
        return;
      }
      if (!new1.val()) {
        if (!confirm('Entering your old password and no new password in settings will remove the security from your FlowNotes. Are you sure you want to continue?')) return;
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
    data.autodelete = $('#autodelete').prop('checked')?$('#deleteafter').val():null;
    if ($('#shareappend').is(':invalid')) {
      div.find('#modal-error').show().text('Invalid input for "Append-to note IDs"');
      return;
    }
    data.shareappend = $('#shareappend').val();
    if ($('#templatenotes').is(':invalid')) {
      div.find('#modal-error').show().text('Invalid input for "Template note IDs"');
      return;
    }
    data.templatenotes = $('#templatenotes').val();
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
  $('#prunemonths').val(settings.prunemonths);
  if (settings.autodelete) {
    $('#autodelete').prop('checked', true);
    $('#deleteafter').val(settings.autodelete);
  }
  $('#uploadstats').text(settings.uploadstats.files + ' files, ' + Math.round(settings.uploadstats.bytes/1048576) + ' MB');
  $('#shareappend').val(settings.shareappend);
  $('#templatenotes').val(settings.templatenotes);
  let tokens = settings.tokens.reduce((r, s) => r.concat(s.device), []).join(', ') || 'none';
  $('#token-list').attr('title', 'This also invalidates all "Remember this device" tokens\nwhich you currently have for the following browsers:\n' + tokens);
}

function loadSnapshots() {
  let div = $('#tab-right').empty()
    .append('<div><input type="button" id="create-snapshot" class="tab-button" value="Create new snapshot"></div><div class="list-divider">Snapshots</div><div id="snapshots" class="scrolly"></div>');
  div.find('#create-snapshot').on('click', function() {
    let note = app.notes[app.activenote];
    if (note.touched) return alert('Last changes not saved yet; please wait 10 seconds and try again');
    sendToServer({ req: 'snapshot', mode: 'add', activenote: app.activenote });
    $('#status').html('Saving snapshot...').css('opacity', 1);
  })
  div.find('#snapshots')
    .on('click', '.snap-li', function(evt) {
      let snap = $(evt.currentTarget);
      location.hash = '#' + app.activenote + '@' + snap.data('modified');
    })
    .on('click', '.snap-action', function(evt) {
      let button = $(evt.currentTarget);
      let snap = button.parent();
      if (button.hasClass('snap-unlock')) {
        button.removeClass('snap-unlock').addClass('snap-lock').prop('title', 'Lock');
        snap.append('<div class="snap-action snap-delete" title="Delete"/>');
        sendToServer({ req: 'snapshot', mode: 'pin', activenote: app.activenote, snapshot: snap.data('id'), value: 0 });
      }
      else if (button.hasClass('snap-lock')) {
        button.removeClass('snap-lock').addClass('snap-unlock').prop('title', 'Unlock');
        snap.find('.snap-delete').remove();
        sendToServer({ req: 'snapshot', mode: 'pin', activenote: app.activenote, snapshot: snap.data('id'), value: 1 });
      }
      else if (button.hasClass('snap-delete')) {
        if (!confirm('Are you sure you want to delete the snapshot ' + snap.find('.snap-modified').text() + '?')) return false;
        sendToServer({ req: 'snapshot', mode: 'del', activenote: app.activenote, snapshot: snap.data('id') });
        $('#status').html('Deleting snapshot...').css('opacity', 1);
        if (app.snap && (app.snap == snap.data('modified'))) window.location = window.location.hash.split('@')[0];
      }
      return false;
    })
    .append(app.loader);
  if (app.snapshots) updateSnapshots();
  else if (app.init) sendToServer({ req: 'snapshot', mode: 'list', activenote: app.activenote });
}
function loadToc() {
  let div = $('#tab-right').empty()
    .append('<div class="list-divider">Headings</div><div id="toc" class="scrolly"></div>');
  div = div.find('#toc');
  app.slugtoraw = {};
  for (let head of markedGfmHeadingId.getHeadingList()) {
    let li = $('<a href="#' + head.id + '"><div class="toc-li">' + head.text + '</div></a>');
    if (head.level > 1) li.children().first().css('margin-left', ((head.level-1)*2) + 'rem');
    div.append(li);
    app.slugtoraw[head.id] = head.text;
  }
}

function showCopied(e) {
  let copied = $('#copied');
  copied.offset({ top: e.pageY-43, left: e.pageX-copied.outerWidth()/2 }).addClass('notransition').css('opacity', 1);
  setTimeout(function() { copied.removeClass('notransition').css('opacity', 0); }, 1000);
}

function lightbox(el) {
  let content = $('<div></div>');
  content.append(el.cloneNode());
  showModal('lightbox', content, 'anyclick');
}
function showModal(type, content, escapable) {
  $('#button-' + type).addClass('button-active');
  app.modal = type;
  let modal = $('#modal-overlay');
  modal.empty().append(content).css({ opacity: '1', pointerEvents: 'auto' });
  if (escapable) modal.on('click', function(evt) {
    if ((escapable == 'anyclick') || (evt.target == this)) hideModal();
  });
  else modal.off('click');
}
function hideModal() {
  $('#button-' + app.modal).removeClass('button-active');
  app.modal = null;
  let modal = $('#modal-overlay');
  modal.empty().css({ opacity: '0', pointerEvents: 'none' });
  modal.off('click');
}

function login(error, challenge) {
  let modal = $('#modal-overlay');
  let content = '<div><h2>Login with password</h2><p>Please enter your password</p><form><p><input type="password" id="password" class="input-password" autocomplete="current-password"></p>'
  content += '<p><input type="checkbox" id="remember"> Remember for this device</p>';
  content += '<p><input type="submit" id="login-pw" class="modal-button" value="Submit"></p></form><p id="modal-error"></p>';
  if (challenge) content += '<h2>Login with U2F key</h2><p><input type="button" id="login-u2f" class="modal-button" value="Activate key"></p>';
  content += '</div>';
  showModal('password', content, false);
  if (error) modal.find('#modal-error').html(error);
  modal.find('#login-pw').on('click', function() {
    let data = { password: modal.find('#password').val() };
    if (modal.find('#remember')[0].checked) data.remember = true;
    init(data);
    modal.empty();
    app.modal = null;
  });
  modal.find('#login-u2f').on('click', function() {
    webauthnAuthenticate(challenge, function(success, info) {
      if (success) {
        init({ response: info });
        $('#modal-error').empty();
      }
      else $('#modal-error').html(info);
    });
  });
  modal.find('#password').focus();
}
function clear() {
  app.notes = [];
  $('#input').val(null).attr('disabled', true);
  $('#render').empty();
  $('#tab-recent').empty();
  $('#tab-pinned').empty();
  $('#search-results').empty();
  $('#links-to,#links-from').empty();
  $('#snapshots').empty();
  $('#toc').empty();
  $('#uploads-linked,#uploads-unlinked').empty();
  $('#stats').empty().hide();
  $('#snap').hide().find('#snapdate').empty();
  $('#link').empty().hide();
  $('#button-settings').removeClass('button-active');
  $('#scrolled').hide();
  $('.loader').detach();
  history.pushState(null, document.title, window.location.pathname);
}
function logout() {
  app.init = false;
  clear();
  let instance = '-';
  instance += location.pathname.split('/').slice(1, -1).join('-');
  localStorage.setItem('flownotes' + instance + 'activenote', app.activenote);
  localStorage.setItem('flownotes' + instance + 'hidepanelleft', app.hidepanelleft);
  localStorage.setItem('flownotes' + instance + 'hidepanelright', app.hidepanelright);
  localStorage.setItem('flownotes' + instance + 'lastpanelright', app.lastpanelright);
  showModal('logout', '<div><p>You have been logged out</p><p><input type="button" class="modal-button" value="Login" onclick="hideModal(); sendToServer({ req: \'init\' });"></p></div>', false);
}

$.fn.getCursorPosition = function(adjust = false) {
  let el = this.get(0);
  let start = el.selectionStart;
  let end = el.selectionEnd;
  if (adjust && (start != end)) {
    start = el.value.lastIndexOf("\n", start) + 1;
    end = el.value.indexOf("\n", end-1) + 1;
  }
  return { start: start, end: end };
}
$.fn.setCursorPosition = function(start, end) {
  if (end === undefined) end = start;
  this.each(function(index, elem) {
    elem.setSelectionRange(start, end);
  });
  return this;
};
$.fn.getScrolledPct = function() {
  return 100 * this[0].scrollTop / (this[0].scrollHeight-this[0].clientHeight);
}
$.fn.setScrolledPct = function(pct) {
  this[0].scrollTop = pct/100 * (this[0].scrollHeight-this[0].clientHeight);
}
$.event.special.touchstart = {
  setup: function(_, ns, handle) {
    this.addEventListener("touchstart", handle, { passive: true });
  }
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

function doUpload() {
  let data, xhr, file = app.uploadqueue.shift();
  if (!file) return;
  let filename = file.name;

  data = new FormData();
  data.append('note', app.activenote);
  data.append('file', file);
  xhr = new XMLHttpRequest();
  xhr.open('POST', 'data.php');
  xhr.upload.onprogress = function(evt) {
    if (evt.lengthComputable) {
      let table = $('#upload-progress TABLE');
      let entry = null;
      for (let row of table.children('tr')) {
        if ($(row).children().first().text() == filename) {
          entry = $(row);
          break;
        }
      }
      if (!entry) entry = $('<tr><td>' + filename + '</td><td></td></tr>').appendTo(table);
      entry.children().eq(1).text(Math.round(evt.loaded / evt.total * 100) + '%');
    }
  };
  xhr.onload = function(evt) {
    if ((this.status == 200) && this.response.length) {
      let data = JSON.parse(this.response);
      if (data.error) {
        $('#upload-progress').append('<p>Error: ' + data.error + '</p>');
        return;
      }
      let cursor = $('#input').getCursorPosition();
      let before = $('#input').val().substring(0, cursor.start);
      let after = $('#input').val().substring(cursor.end);
      let links = '';
      for (let file of data.files) {
        if (file.type.startsWith('image/')) links += '!';
        links += '[' + file.name + '](' + file.path + ')\n';
      }
      $('#input').val(before + links + after).setCursorPosition(cursor.start+links.length);
      app.notes[data.note].touched = true;
      $('.note-li[data-id=' + data.note + ']').addClass('note-touched');
      $('#button-mode-edit').addClass('button-touched');
      $('#uploads-linked').append(app.loader).find('.list-none').remove();
      app.changed = Date.now()-60000; // Force a pushUpdate on the next tick
    }
    if (app.uploadqueue.length) doUpload();
    else hideModal();
  }
  xhr.send(data);
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

// Day.js 1.11.10 (https://github.com/iamkun/dayjs/) - MIT license
!function(t,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(t="undefined"!=typeof globalThis?globalThis:t||self).dayjs=e()}(this,(function(){"use strict";var t=1e3,e=6e4,n=36e5,r="millisecond",i="second",s="minute",u="hour",a="day",o="week",c="month",f="quarter",h="year",d="date",l="Invalid Date",$=/^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/,y=/\[([^\]]+)]|Y{1,4}|M{1,4}|D{1,2}|d{1,4}|H{1,2}|h{1,2}|a|A|m{1,2}|s{1,2}|Z{1,2}|SSS/g,M={name:"en",weekdays:"Sunday_Monday_Tuesday_Wednesday_Thursday_Friday_Saturday".split("_"),months:"January_February_March_April_May_June_July_August_September_October_November_December".split("_"),ordinal:function(t){var e=["th","st","nd","rd"],n=t%100;return"["+t+(e[(n-20)%10]||e[n]||e[0])+"]"}},m=function(t,e,n){var r=String(t);return!r||r.length>=e?t:""+Array(e+1-r.length).join(n)+t},v={s:m,z:function(t){var e=-t.utcOffset(),n=Math.abs(e),r=Math.floor(n/60),i=n%60;return(e<=0?"+":"-")+m(r,2,"0")+":"+m(i,2,"0")},m:function t(e,n){if(e.date()<n.date())return-t(n,e);var r=12*(n.year()-e.year())+(n.month()-e.month()),i=e.clone().add(r,c),s=n-i<0,u=e.clone().add(r+(s?-1:1),c);return+(-(r+(n-i)/(s?i-u:u-i))||0)},a:function(t){return t<0?Math.ceil(t)||0:Math.floor(t)},p:function(t){return{M:c,y:h,w:o,d:a,D:d,h:u,m:s,s:i,ms:r,Q:f}[t]||String(t||"").toLowerCase().replace(/s$/,"")},u:function(t){return void 0===t}},g="en",D={};D[g]=M;var p="$isDayjsObject",S=function(t){return t instanceof _||!(!t||!t[p])},w=function t(e,n,r){var i;if(!e)return g;if("string"==typeof e){var s=e.toLowerCase();D[s]&&(i=s),n&&(D[s]=n,i=s);var u=e.split("-");if(!i&&u.length>1)return t(u[0])}else{var a=e.name;D[a]=e,i=a}return!r&&i&&(g=i),i||!r&&g},O=function(t,e){if(S(t))return t.clone();var n="object"==typeof e?e:{};return n.date=t,n.args=arguments,new _(n)},b=v;b.l=w,b.i=S,b.w=function(t,e){return O(t,{locale:e.$L,utc:e.$u,x:e.$x,$offset:e.$offset})};var _=function(){function M(t){this.$L=w(t.locale,null,!0),this.parse(t),this.$x=this.$x||t.x||{},this[p]=!0}var m=M.prototype;return m.parse=function(t){this.$d=function(t){var e=t.date,n=t.utc;if(null===e)return new Date(NaN);if(b.u(e))return new Date;if(e instanceof Date)return new Date(e);if("string"==typeof e&&!/Z$/i.test(e)){var r=e.match($);if(r){var i=r[2]-1||0,s=(r[7]||"0").substring(0,3);return n?new Date(Date.UTC(r[1],i,r[3]||1,r[4]||0,r[5]||0,r[6]||0,s)):new Date(r[1],i,r[3]||1,r[4]||0,r[5]||0,r[6]||0,s)}}return new Date(e)}(t),this.init()},m.init=function(){var t=this.$d;this.$y=t.getFullYear(),this.$M=t.getMonth(),this.$D=t.getDate(),this.$W=t.getDay(),this.$H=t.getHours(),this.$m=t.getMinutes(),this.$s=t.getSeconds(),this.$ms=t.getMilliseconds()},m.$utils=function(){return b},m.isValid=function(){return!(this.$d.toString()===l)},m.isSame=function(t,e){var n=O(t);return this.startOf(e)<=n&&n<=this.endOf(e)},m.isAfter=function(t,e){return O(t)<this.startOf(e)},m.isBefore=function(t,e){return this.endOf(e)<O(t)},m.$g=function(t,e,n){return b.u(t)?this[e]:this.set(n,t)},m.unix=function(){return Math.floor(this.valueOf()/1e3)},m.valueOf=function(){return this.$d.getTime()},m.startOf=function(t,e){var n=this,r=!!b.u(e)||e,f=b.p(t),l=function(t,e){var i=b.w(n.$u?Date.UTC(n.$y,e,t):new Date(n.$y,e,t),n);return r?i:i.endOf(a)},$=function(t,e){return b.w(n.toDate()[t].apply(n.toDate("s"),(r?[0,0,0,0]:[23,59,59,999]).slice(e)),n)},y=this.$W,M=this.$M,m=this.$D,v="set"+(this.$u?"UTC":"");switch(f){case h:return r?l(1,0):l(31,11);case c:return r?l(1,M):l(0,M+1);case o:var g=this.$locale().weekStart||0,D=(y<g?y+7:y)-g;return l(r?m-D:m+(6-D),M);case a:case d:return $(v+"Hours",0);case u:return $(v+"Minutes",1);case s:return $(v+"Seconds",2);case i:return $(v+"Milliseconds",3);default:return this.clone()}},m.endOf=function(t){return this.startOf(t,!1)},m.$set=function(t,e){var n,o=b.p(t),f="set"+(this.$u?"UTC":""),l=(n={},n[a]=f+"Date",n[d]=f+"Date",n[c]=f+"Month",n[h]=f+"FullYear",n[u]=f+"Hours",n[s]=f+"Minutes",n[i]=f+"Seconds",n[r]=f+"Milliseconds",n)[o],$=o===a?this.$D+(e-this.$W):e;if(o===c||o===h){var y=this.clone().set(d,1);y.$d[l]($),y.init(),this.$d=y.set(d,Math.min(this.$D,y.daysInMonth())).$d}else l&&this.$d[l]($);return this.init(),this},m.set=function(t,e){return this.clone().$set(t,e)},m.get=function(t){return this[b.p(t)]()},m.add=function(r,f){var d,l=this;r=Number(r);var $=b.p(f),y=function(t){var e=O(l);return b.w(e.date(e.date()+Math.round(t*r)),l)};if($===c)return this.set(c,this.$M+r);if($===h)return this.set(h,this.$y+r);if($===a)return y(1);if($===o)return y(7);var M=(d={},d[s]=e,d[u]=n,d[i]=t,d)[$]||1,m=this.$d.getTime()+r*M;return b.w(m,this)},m.subtract=function(t,e){return this.add(-1*t,e)},m.format=function(t){var e=this,n=this.$locale();if(!this.isValid())return n.invalidDate||l;var r=t||"YYYY-MM-DDTHH:mm:ssZ",i=b.z(this),s=this.$H,u=this.$m,a=this.$M,o=n.weekdays,c=n.months,f=n.meridiem,h=function(t,n,i,s){return t&&(t[n]||t(e,r))||i[n].slice(0,s)},d=function(t){return b.s(s%12||12,t,"0")},$=f||function(t,e,n){var r=t<12?"AM":"PM";return n?r.toLowerCase():r};return r.replace(y,(function(t,r){return r||function(t){switch(t){case"YY":return String(e.$y).slice(-2);case"YYYY":return b.s(e.$y,4,"0");case"M":return a+1;case"MM":return b.s(a+1,2,"0");case"MMM":return h(n.monthsShort,a,c,3);case"MMMM":return h(c,a);case"D":return e.$D;case"DD":return b.s(e.$D,2,"0");case"d":return String(e.$W);case"dd":return h(n.weekdaysMin,e.$W,o,2);case"ddd":return h(n.weekdaysShort,e.$W,o,3);case"dddd":return o[e.$W];case"H":return String(s);case"HH":return b.s(s,2,"0");case"h":return d(1);case"hh":return d(2);case"a":return $(s,u,!0);case"A":return $(s,u,!1);case"m":return String(u);case"mm":return b.s(u,2,"0");case"s":return String(e.$s);case"ss":return b.s(e.$s,2,"0");case"SSS":return b.s(e.$ms,3,"0");case"Z":return i}return null}(t)||i.replace(":","")}))},m.utcOffset=function(){return 15*-Math.round(this.$d.getTimezoneOffset()/15)},m.diff=function(r,d,l){var $,y=this,M=b.p(d),m=O(r),v=(m.utcOffset()-this.utcOffset())*e,g=this-m,D=function(){return b.m(y,m)};switch(M){case h:$=D()/12;break;case c:$=D();break;case f:$=D()/3;break;case o:$=(g-v)/6048e5;break;case a:$=(g-v)/864e5;break;case u:$=g/n;break;case s:$=g/e;break;case i:$=g/t;break;default:$=g}return l?$:b.a($)},m.daysInMonth=function(){return this.endOf(c).$D},m.$locale=function(){return D[this.$L]},m.locale=function(t,e){if(!t)return this.$L;var n=this.clone(),r=w(t,e,!0);return r&&(n.$L=r),n},m.clone=function(){return b.w(this.$d,this)},m.toDate=function(){return new Date(this.valueOf())},m.toJSON=function(){return this.isValid()?this.toISOString():null},m.toISOString=function(){return this.$d.toISOString()},m.toString=function(){return this.$d.toUTCString()},M}(),k=_.prototype;return O.prototype=k,[["$ms",r],["$s",i],["$m",s],["$H",u],["$W",a],["$M",c],["$y",h],["$D",d]].forEach((function(t){k[t[1]]=function(e){return this.$g(e,t[0],t[1])}})),O.extend=function(t,e){return t.$i||(t(e,_,O),t.$i=!0),O},O.locale=w,O.isDayjs=S,O.unix=function(t){return O(1e3*t)},O.en=D[g],O.Ls=D,O.p={},O}));
// Day.js plugin relativeTime
!function(r,e){"object"==typeof exports&&"undefined"!=typeof module?module.exports=e():"function"==typeof define&&define.amd?define(e):(r="undefined"!=typeof globalThis?globalThis:r||self).dayjs_plugin_relativeTime=e()}(this,(function(){"use strict";return function(r,e,t){r=r||{};var n=e.prototype,o={future:"in %s",past:"%s ago",s:"a few seconds",m:"a minute",mm:"%d minutes",h:"an hour",hh:"%d hours",d:"a day",dd:"%d days",M:"a month",MM:"%d months",y:"a year",yy:"%d years"};function i(r,e,t,o){return n.fromToBase(r,e,t,o)}t.en.relativeTime=o,n.fromToBase=function(e,n,i,d,u){for(var f,a,s,l=i.$locale().relativeTime||o,h=r.thresholds||[{l:"s",r:44,d:"second"},{l:"m",r:89},{l:"mm",r:44,d:"minute"},{l:"h",r:89},{l:"hh",r:21,d:"hour"},{l:"d",r:35},{l:"dd",r:25,d:"day"},{l:"M",r:45},{l:"MM",r:10,d:"month"},{l:"y",r:17},{l:"yy",d:"year"}],m=h.length,c=0;c<m;c+=1){var y=h[c];y.d&&(f=d?t(e).diff(i,y.d,!0):i.diff(e,y.d,!0));var p=(r.rounding||Math.round)(Math.abs(f));if(s=f>0,p<=y.r||!y.r){p<=1&&c>0&&(y=h[c-1]);var v=l[y.l];u&&(p=u(""+p)),a="string"==typeof v?v.replace("%d",p):v(p,n,y.l,s);break}}if(n)return a;var M=s?l.future:l.past;return"function"==typeof M?M(a):M.replace("%s",a)},n.to=function(r,e){return i(r,e,this,!0)},n.from=function(r,e){return i(r,e,this)};var d=function(r){return r.$u?t.utc():t()};n.toNow=function(r){return this.to(d(this),r)},n.fromNow=function(r){return this.from(d(this),r)}}}));
// Day.js plugin updateLocale
!function(e,n){"object"==typeof exports&&"undefined"!=typeof module?module.exports=n():"function"==typeof define&&define.amd?define(n):(e="undefined"!=typeof globalThis?globalThis:e||self).dayjs_plugin_updateLocale=n()}(this,(function(){"use strict";return function(e,n,t){t.updateLocale=function(e,n){var o=t.Ls[e];if(o)return(n?Object.keys(n):[]).forEach((function(e){o[e]=n[e]})),o}}}));
// Day.js plugin calendar
!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?module.exports=t():"function"==typeof define&&define.amd?define(t):(e="undefined"!=typeof globalThis?globalThis:e||self).dayjs_plugin_calendar=t()}(this,(function(){"use strict";return function(e,t,a){var n="h:mm A",d={lastDay:"[Yesterday at] "+n,sameDay:"[Today at] "+n,nextDay:"[Tomorrow at] "+n,nextWeek:"dddd [at] "+n,lastWeek:"[Last] dddd [at] "+n,sameElse:"MM/DD/YYYY"};t.prototype.calendar=function(e,t){var n=t||this.$locale().calendar||d,o=a(e||void 0).startOf("d"),s=this.diff(o,"d",!0),i="sameElse",f=s<-6?i:s<-1?"lastWeek":s<0?"lastDay":s<1?"sameDay":s<2?"nextDay":s<7?"nextWeek":i,l=n[f]||d[f];return"function"==typeof l?l.call(this,a()):this.format(l)}}}));

dayjs.extend(dayjs_plugin_relativeTime);
dayjs.extend(dayjs_plugin_calendar);
dayjs.extend(dayjs_plugin_updateLocale);
dayjs.updateLocale('en', {
  calendar: {
    sameDay: '[today]',
    lastDay: '[yesterday]',
    lastWeek: '[last] dddd',
    sameElse: function() { return this.fromNow(); }
  }
});

/*
 * Javascript Diff Algorithm
 *  By John Resig (http://ejohn.org/)
 *  Modified by Chu Alan "sprite"
 *
 * Released under the MIT license.
 *
 * More Info:
 *  http://ejohn.org/projects/javascript-diff-algorithm/
 */

function escape(s) {
  var n = s;
  n = n.replace(/&/g, "&amp;");
  n = n.replace(/</g, "&lt;");
  n = n.replace(/>/g, "&gt;");
  n = n.replace(/"/g, "&quot;");

  return n;
}

function diffString( o, n ) {
o = o.replace(/\s+$/, '');
n = n.replace(/\s+$/, '');

var out = diff(o == "" ? [] : o.split(/\s+/), n == "" ? [] : n.split(/\s+/) );
var str = "";

var oSpace = o.match(/\s+/g);
if (oSpace == null) {
  oSpace = ["\n"];
} else {
  oSpace.push("\n");
}
var nSpace = n.match(/\s+/g);
if (nSpace == null) {
  nSpace = ["\n"];
} else {
  nSpace.push("\n");
}

if (out.n.length == 0) {
    for (var i = 0; i < out.o.length; i++) {
      str += '<del>' + escape(out.o[i]) + oSpace[i] + "</del>";
    }
} else {
  if (out.n[0].text == null) {
    for (n = 0; n < out.o.length && out.o[n].text == null; n++) {
      str += '<del>' + escape(out.o[n]) + oSpace[n] + "</del>";
    }
  }

  for ( var i = 0; i < out.n.length; i++ ) {
    if (out.n[i].text == null) {
      str += '<ins>' + escape(out.n[i]) + nSpace[i] + "</ins>";
    } else {
      var pre = "";

      for (n = out.n[i].row + 1; n < out.o.length && out.o[n].text == null; n++ ) {
        pre += '<del>' + escape(out.o[n]) + oSpace[n] + "</del>";
      }
      str += out.n[i].text + nSpace[i] + pre;
    }
  }
}

return str;
}

function diff( o, n ) {
var ns = {};
var os = {};

for ( var i = 0; i < n.length; i++ ) {
  if ( ns[ n[i] ] == null )
    ns[ n[i] ] = { rows: new Array(), o: null };
  ns[ n[i] ].rows.push( i );
}

for ( var i = 0; i < o.length; i++ ) {
  if ( os[ o[i] ] == null )
    os[ o[i] ] = { rows: new Array(), n: null };
  os[ o[i] ].rows.push( i );
}

for ( var i in ns ) {
  if ( ns[i].rows.length == 1 && typeof(os[i]) != "undefined" && os[i].rows.length == 1 ) {
    n[ ns[i].rows[0] ] = { text: n[ ns[i].rows[0] ], row: os[i].rows[0] };
    o[ os[i].rows[0] ] = { text: o[ os[i].rows[0] ], row: ns[i].rows[0] };
  }
}

for ( var i = 0; i < n.length - 1; i++ ) {
  if ( n[i].text != null && n[i+1].text == null && n[i].row + 1 < o.length && o[ n[i].row + 1 ].text == null && 
       n[i+1] == o[ n[i].row + 1 ] ) {
    n[i+1] = { text: n[i+1], row: n[i].row + 1 };
    o[n[i].row+1] = { text: o[n[i].row+1], row: i + 1 };
  }
}

for ( var i = n.length - 1; i > 0; i-- ) {
  if ( n[i].text != null && n[i-1].text == null && n[i].row > 0 && o[ n[i].row - 1 ].text == null && 
       n[i-1] == o[ n[i].row - 1 ] ) {
    n[i-1] = { text: n[i-1], row: n[i].row - 1 };
    o[n[i].row-1] = { text: o[n[i].row-1], row: i - 1 };
  }
}

return { o: o, n: n };
}
