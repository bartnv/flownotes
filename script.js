var app = {
  mode: 'edit',
  activenote: 1,
  notes: [],
  inactive: 0,
  changed: 0,
  offline: 0,
  lastupdate: 0
}

$(document).on('keydown', function(evt) {
  if (evt.key == 'F2') {
    if (app.mode == 'graph') switchMode(app.prev);
    else switchMode('graph');
    sendToServer({ req: 'activate', mode: app.mode, modified: app.notes[app.activenote].modified, lazy: true, lastupdate: app.lastupdate });
    return false;
  }
  else if (evt.key == 'F4') {
    if (app.mode == 'view') switchMode('edit');
    else switchMode('view');
    sendToServer({ req: 'activate', mode: app.mode, modified: app.notes[app.activenote].modified, lazy: true, lastupdate: app.lastupdate });
    return false;
  }
});

$().ready(function() {
  marked.setOptions({
    breaks: true
  });
  app.renderer = new marked.Renderer();
  app.renderer.link = function(href, title, text) {
    if (href.match(/^#[0-9]+$/)) {
      if (text.startsWith('=') && (text != '=')) text = text.substr(1);
      return '<a href="' + href + '">' + text + '</a>';
    }
    return '<a href="' + href + '" target="_blank">' + text + '</a>';
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
  let data = { req: 'init' };
  if (location.hash.match(/^#[0-9]+$/)) data.activenote = location.hash.substr(1);
  sendToServer(data).always(function() { setInterval(tick, 5000); });
  $('#input').on('keydown', function(e) {
    if (e.originalEvent.ctrlKey && (e.originalEvent.code == 'Enter')) {
      app.addlink = true;
      sendToServer({ req: 'add', lastupdate: app.lastupdate });
    }
  }).on('input', function() {
    if (!app.changed) app.changed = Date.now();
    app.notes[app.activenote].touched = true;
    app.inactive = 0;
  });
  $(window).on('hashchange', function(e) {
    if (location.hash.match(/^#[0-9]+$/)) {
      let id = parseInt(location.hash.substr(1));
      if (id != app.activenote) activateNote(id);
    }
  }).on('unload', function() { // Use navigator.sendBeacon for this in the future
    if (app.changed) {
      app.notes[app.activenote].content = $('#input').val();
      pushUpdate(true);
    }
  });
  $('#label-recent').on('click', function() { activateTab('recent'); });
  $('#label-search').on('click', function() {
    activateTab('search');
    $('#search-input').select();
  });
  $('#label-pinned').on('click', function() { activateTab('pinned'); });
  $('#search-input').on('keyup', function(e) {
    if (e.originalEvent.code == 'Enter') $('#search-button').click();
  });
  $('#search-button').on('click', function() {
    sendToServer({ req: 'search', term: $('#search-input').val(), lastupdate: app.lastupdate });
    $('#search-input').select();
  });
  $('#button-panel-hide').on('click', function() {
    if (app.hidepanelleft) {
      app.hidepanelleft = false;
      $(this).addClass('button-active').attr('title', 'Hide left panel');
      $('#panel-left').css('margin-left', '0');
    }
    else {
      app.hidepanelleft = true;
      $(this).removeClass('button-active').attr('title', 'Show left panel');
      $('#panel-left').css('margin-left', '-20em');
    }
  });
  $('#panel-left').on('mousedown', '.note-li', function (evt) {
    app.linkid = $(evt.currentTarget).addClass('note-selected').data('id');
    $('body').css('cursor', 'alias');
    $('#input').css('cursor', 'inherit');
    return false;
  });
  $('#input').on('mouseup', function() {
    if (!app.linkid) return;
    let input = $(this);
    let content = input.val();
    if (this.selectionStart != this.selectionEnd) { // We have text selected, use as linktext
      var linkstr = '[' + content.substring(this.selectionStart, this.selectionEnd) + '](#' + app.linkid + ')';
    }
    else var linkstr = '[=' + app.notes[app.linkid].title + '](#' + app.linkid + ')';
    let pos = this.selectionStart + linkstr.length;
    input.val(content.substr(0, this.selectionStart) + linkstr + content.substr(this.selectionEnd));
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
  $('#panel-buttons').on('click', '.button-mode', function(e) {
    switchMode(this.id.split('-')[2]);
    sendToServer({ req: 'activate', mode: app.mode, modified: app.notes[app.activenote].modified, lazy: true, lastupdate: app.lastupdate });
  });
  $('#button-note-add').on('click', function() {
    sendToServer({ req: 'add', lastupdate: app.lastupdate });
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
    var link = $('<a target="_blank" href="mailto:?body=' + encodeURIComponent($('#input').val()).replace(/%0A/gi, '%0D%0A') + '"></a>');
    $('body').append(link);
    link[0].click();
    link.remove();
  });
  $('#button-note-del').on('click', function() {
    if (confirm('Are you sure you want to delete note #' + app.activenote + ' "' + app.notes[app.activenote].title + '"?')) {
      sendToServer({ req: 'delete', id: app.activenote, lastupdate: app.lastupdate });
      // let notes = Object.keys(app.notes).map(function(x) { return app.notes[x]; });
      // notes.sort(function(a, b) { return b.modified - a.modified; });
      // location.hash = '#' + notes[0]['id'];
    }
  });
});

function unpinNote(id) {
  app.notes[id].pinned = 0;
  let data = { req: 'update', notes: {}, lastupdate: app.lastupdate };
  data.notes[id] = {};
  data.notes[id].pinned = 0;
  sendToServer(data);
  if ($('#label-pinned').hasClass('tab-active')) updatePanels();
  if (id == app.activenote) $('#button-note-pin').removeClass('button-active').attr('title', 'Pin note');
}
function loadNote(id) {
  if (app.mode == 'view') render(app.notes[id].content);
  else if (app.mode == 'graph') loadGraph();
  if (app.notes[id].pinned) $('#button-note-pin').addClass('button-active').attr('title', 'Unpin note');
  else $('#button-note-pin').removeClass('button-active').attr('title', 'Pin note');
  $('#input').val(app.notes[id].content).attr('disabled', false).focus();
}

function render(content) {
  let el = $('#render');
  el.html(marked(content, { renderer: app.renderer }));
  el.find('PRE').append('<img class="code-copy" src="clippy.svg" onclick="copy(this);">');
  return el;
}
function copy(btn) {
  selectText($(btn).parent().find('code').get(0));
  document.execCommand('copy');
  selectText(btn);
}

function tick() {
  app.inactive++;
  if (app.changed && ((app.inactive > 1) || (Date.now()-app.changed > 60000))) {
    app.changed = 0;
    if (app.notes[app.activenote].touched) {
      app.notes[app.activenote].content = $('#input').val();
      app.notes[app.activenote].title = findTitle(app.notes[app.activenote].content);
    }
    pushUpdate();
  }
  else if (app.inactive%12 == 0) sendToServer({ req: 'idle', lastupdate: app.lastupdate });
}

function pushUpdate(sync, retransmit) {
  let data = { req: 'update', activenote: app.activenote, notes: {}, lastupdate: app.lastupdate };
  for (let i in app.notes) {
    if (app.notes[i].touched) {
      data.notes[i] = app.notes[i];
      delete app.notes[i].touched;
      app.notes[i].intransit = true;
    }
  }
  if (retransmit) {
    for (let i in app.notes) {
      if (app.notes[i].intransit) data.notes[i] = app.notes[i];
    }
  }
  sendToServer(data, sync);
}

function sendToServer(data, sync) {
  let async = true;
  if (sync) async = false;
  return $.post({ url: 'data.php', data: JSON.stringify(data), contentType: 'application/json', async: async }).done(parseFromServer).fail(offline);
}
function parseFromServer(data, textStatus, xhr) {
  if (xhr.status != 200) return offline();
  if (data.error) return alert('Error: ' + data.error);
  if (app.offline) {
    app.offline = 0;
    pushUpdate(false, true);
  }

  $('#status').css('opacity', '0');
  if (data.activenote) {
    if (app.addlink) {
      let input = $('#input')[0];
      let pos = input.selectionStart;
      let val = input.value;
      let link = '[=](#' + data.activenote + ')';
      input.value = val.substring(0, pos) + link + val.substring(pos);
      app.notes[app.activenote].touched = true;
      app.addlink = false;
    }
    if (location.hash != '#'+data.activenote) location.hash = '#'+data.activenote;
    else activateNote(parseInt(data.activenote), true);
  }
  if (data.activetableft) activateTab(data.activetableft);
  let reload = false;
  for (let i in data.notes) {
    if (!app.notes[i]) app.notes[i] = { id: i };
    if (data.notes[i].title) app.notes[i].title = data.notes[i].title;
    else if (!app.notes[i].title) app.notes[i].title = '{no title}';
    if (data.notes[i].modified) {
      app.notes[i].modified = data.notes[i].modified;
      if (app.notes[i].intransit) delete app.notes[i].intransit;
      if (data.notes[i].modified > app.lastupdate) app.lastupdate = data.notes[i].modified;
    }
    if (data.notes[i].pinned) app.notes[i].pinned = parseInt(data.notes[i].pinned);
    if (data.notes[i].deleted === 'true') app.notes[i].deleted = true;
    if (data.notes[i].flinks !== undefined) app.notes[i].flinks = data.notes[i].flinks;
    if (data.notes[i].blinks !== undefined) app.notes[i].blinks = data.notes[i].blinks;
    if ((data.notes[i].content !== undefined) && (app.notes[i].content !== data.notes[i].content)) {
      app.notes[i].content = data.notes[i].content;
      if ((i == app.activenote) && !app.notes[app.activenote].touched) reload = true;
    }
  }
  if (reload) loadNote(app.activenote);
  if (data.searchresults) listSearchResults(data.searchresults);
  if (data.mode && (data.mode != app.mode)) switchMode(data.mode);
  if (app.notes[app.activenote].deleted) {
    $('#input').attr('disabled', true);
    $('#status').html('Note #' + app.activenote + ' has been deleted').css('opacity', 1);
  }
  updatePanels();
}
function offline() {
  if (!app.offline) {
    app.offline = Date.now();
    $('#status').html('Connection failed, switching to offline mode').css('opacity', 1);
  }
  else {
    let count = 0;
    for (let i in app.notes) {
      if (app.notes[i].touched || app.notes[i].intransit) count++;
    }
    if (count) $('#status').html('Offline mode (' + count + ' unsaved notes)').css('opacity', 1);
    else $('#status').html('Offline mode').css('opacity', 1);
  }
  if (app.notes[app.activenote].content === undefined) {
    $('#input').val('');
    $('#render').empty();
  }
}

function switchMode(newmode) {
  app.prev = app.mode;
  app.mode = newmode;
  if (app.mode == 'edit') {
    $('#render').hide().empty();
    $('#graph').hide();
    $('#input').show().focus();
  }
  else if (app.mode == 'view') {
    $('#input').hide();
    render($('#input').val()).show();
    $('#graph').hide();
  }
  else if (app.mode == 'graph') {
    $('#input').hide();
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
  for (let i in note.flinks) {
    let link = app.notes[note.flinks[i]];
    try {
      app.graph.graph.addNode({ id: String(note.flinks[i]), label: link && link.title || 'not loaded', x: 75, y: y, size: 1 });
      app.graph.graph.addEdge({ id: app.activenote + '-' + note.flinks[i], source: String(app.activenote), target: String(note.flinks[i]) });
    }
    catch (e) {}
    if (y > 0) y = -y;
    else y = -y+10;
  }
  y = 0;
  for (let i in note.blinks) {
    let link = app.notes[note.blinks[i]];
    try {
      app.graph.graph.addNode({ id: String(note.blinks[i]), label: link && link.title || 'not loaded', x: 25, y: y, size: 1 });
      app.graph.graph.addEdge({ id: app.activenote + '-' + note.blinks[i], source: String(note.blinks[i]), target: String(app.activenote) });
    }
    catch (e) {}
    if (y > 0) y = -y;
    else y = -y+10;
  }
  app.graph.refresh();
}

function updatePanels() {
  let notes = Object.keys(app.notes).map(function(x) { return app.notes[x]; });
  if ($('#label-pinned').hasClass('tab-active')) {
    notes.sort(function(a, b) { return (b.pinned||-1) - (a.pinned||-1); });
    count = 0;
    let pinned = "";
    for (let i in notes) {
      let note = notes[i];
      if (!note.pinned) break;
      let extraclass = '';
      if (note.id == app.activenote) extraclass = ' note-active';
      if (note.deleted) extraclass += ' note-deleted';
      pinned += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '" data-id="' + note.id + '">';
      pinned += '<img class="button-unpin" src="cross.svg" onclick="unpinNote(' + note.id + '); return false;" title="Unpin">';
      pinned += '<span class="note-title">' + note.title + '</span><br>';
      pinned += '<span class="note-modified">saved at ' + new Date(note.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
      if (++count >= 20) break;
    }
    $('#tab-pinned').empty().html(pinned);
  }
  else if ($('#label-recent').hasClass('tab-active')) {
    notes = notes.filter(function(x) { return !x.deleted; });
    notes.sort(function(a, b) { return b.modified - a.modified; });
    let count = 0;
    let last20 = "";
    for (let i in notes) {
      let note = notes[i];
      let extraclass = '';
      if (note.id == app.activenote) extraclass = ' note-active';
      last20 += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '" data-id="' + note.id + '"><span class="note-title">' + note.title + '</span><br>';
      last20 += '<span class="note-modified">saved at ' + new Date(note.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
      if (++count >= 20) break;
    }
    $('#tab-recent').empty().html(last20);
  }
}

function findTitle(text) {
  matches = text.match(/^\s*#+\s*([^#\r\n]+)/m);
  if (matches) return matches[1];
  matches = text.match(/^\s*([A-Za-z0-9][A-Za-z0-9 ]+[A-Za-z0-9 ])/m);
  if (matches) return matches[1];
  return '{no title}';
}

function activateNote(id, nopost) {
  if (app.notes[app.activenote] && app.notes[app.activenote].touched) {
    app.notes[app.activenote].content = $('#input').val();
    app.notes[app.activenote].title = findTitle(app.notes[app.activenote].content);
  }
  app.activenote = id;
  if (!nopost) {
    let data = { req: 'activate', activenote: app.activenote, modified: app.notes[app.activenote].modified, lastupdate: app.lastupdate };
    if (app.notes[id].content !== undefined) {
//      if (app.mode == 'graph') switchMode(app.prev);
      loadNote(app.activenote);
      updatePanels();
      data.lazy = true;
    }
    else {
      data.lazy = false;
      $('#input').attr('disabled', true);
      $('#status').html('Loading...').css('opacity', 1);
    }
    sendToServer(data);
  }
  $('.note-li').removeClass('note-active');
  $('a[href="#' + app.activenote + '"]').children().addClass('note-active');
}
function activateTab(name) {
  $('#label-' + name).addClass('tab-active').siblings().removeClass('tab-active');
  $('#tab-' + name).show().siblings('.tab').hide();
  if (name == 'search') $('#search-input').focus();
  updatePanels();
}

function listSearchResults(items) {
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
  if (items.length == 1) {
    location.hash = '#' + app.notes[items[0]].id;
    setTimeout("$('#search-input').focus();", 100);
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
function selectText(el) {
  if (document.selection) {
    var range = document.body.createTextRange();
    range.moveToElementText(el);
    range.select();
  }
  else if (window.getSelection) {
    var range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }
}

// date.format library (https://github.com/jacwright/date.format) by Jacob Wright and others - MIT license
(function(){Date.shortMonths=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],Date.longMonths=["January","February","March","April","May","June","July","August","September","October","November","December"],Date.shortDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],Date.longDays=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];var t={d:function(){return(this.getDate()<10?"0":"")+this.getDate()},D:function(){return Date.shortDays[this.getDay()]},j:function(){return this.getDate()},l:function(){return Date.longDays[this.getDay()]},N:function(){return 0==this.getDay()?7:this.getDay()},S:function(){return this.getDate()%10==1&&11!=this.getDate()?"st":this.getDate()%10==2&&12!=this.getDate()?"nd":this.getDate()%10==3&&13!=this.getDate()?"rd":"th"},w:function(){return this.getDay()},z:function(){var t=new Date(this.getFullYear(),0,1);return Math.ceil((this-t)/864e5)},W:function(){var t=new Date(this.valueOf()),e=(this.getDay()+6)%7;t.setDate(t.getDate()-e+3);var n=t.valueOf();return t.setMonth(0,1),4!==t.getDay()&&t.setMonth(0,1+(4-t.getDay()+7)%7),1+Math.ceil((n-t)/6048e5)},F:function(){return Date.longMonths[this.getMonth()]},m:function(){return(this.getMonth()<9?"0":"")+(this.getMonth()+1)},M:function(){return Date.shortMonths[this.getMonth()]},n:function(){return this.getMonth()+1},t:function(){var t=this.getFullYear(),e=this.getMonth()+1;return 12===e&&(t=t++,e=0),new Date(t,e,0).getDate()},L:function(){var t=this.getFullYear();return t%400==0||t%100!=0&&t%4==0},o:function(){var t=new Date(this.valueOf());return t.setDate(t.getDate()-(this.getDay()+6)%7+3),t.getFullYear()},Y:function(){return this.getFullYear()},y:function(){return(""+this.getFullYear()).substr(2)},a:function(){return this.getHours()<12?"am":"pm"},A:function(){return this.getHours()<12?"AM":"PM"},B:function(){return Math.floor(1e3*((this.getUTCHours()+1)%24+this.getUTCMinutes()/60+this.getUTCSeconds()/3600)/24)},g:function(){return this.getHours()%12||12},G:function(){return this.getHours()},h:function(){return((this.getHours()%12||12)<10?"0":"")+(this.getHours()%12||12)},H:function(){return(this.getHours()<10?"0":"")+this.getHours()},i:function(){return(this.getMinutes()<10?"0":"")+this.getMinutes()},s:function(){return(this.getSeconds()<10?"0":"")+this.getSeconds()},u:function(){var t=this.getMilliseconds();return(10>t?"00":100>t?"0":"")+t},e:function(){return/\((.*)\)/.exec((new Date).toString())[1]},I:function(){for(var t=null,e=0;12>e;++e){var n=new Date(this.getFullYear(),e,1),i=n.getTimezoneOffset();if(null===t)t=i;else{if(t>i){t=i;break}if(i>t)break}}return this.getTimezoneOffset()==t|0},O:function(){return(-this.getTimezoneOffset()<0?"-":"+")+(Math.abs(this.getTimezoneOffset()/60)<10?"0":"")+Math.floor(Math.abs(this.getTimezoneOffset()/60))+(0==Math.abs(this.getTimezoneOffset()%60)?"00":(Math.abs(this.getTimezoneOffset()%60)<10?"0":"")+Math.abs(this.getTimezoneOffset()%60))},P:function(){return(-this.getTimezoneOffset()<0?"-":"+")+(Math.abs(this.getTimezoneOffset()/60)<10?"0":"")+Math.floor(Math.abs(this.getTimezoneOffset()/60))+":"+(0==Math.abs(this.getTimezoneOffset()%60)?"00":(Math.abs(this.getTimezoneOffset()%60)<10?"0":"")+Math.abs(this.getTimezoneOffset()%60))},T:function(){return this.toTimeString().replace(/^.+ \(?([^\)]+)\)?$/,"$1")},Z:function(){return 60*-this.getTimezoneOffset()},c:function(){return this.format("Y-m-d\\TH:i:sP")},r:function(){return this.toString()},U:function(){return this.getTime()/1e3}};Date.prototype.format=function(e){var n=this;return e.replace(/(\\?)(.)/g,function(e,i,r){return""===i&&t[r]?t[r].call(n):r})}}).call(this);

// String.startsWith polyfill to support IE11
if (!String.prototype.startsWith) { String.prototype.startsWith = function(searchString, position) { position = position || 0; return this.indexOf(searchString, position) === position; }; }
