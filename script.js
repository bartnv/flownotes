var app = {
  mode: 'edit',
  activenote: 1,
  notes: [],
  inactive: 0,
  changed: 0,
  offline: 0
}

$(document).on('keydown', function(evt) {
  if (evt.key == 'F2') {
    if (app.mode == 'graph') switchMode(app.prev);
    else {
      app.prev = app.mode;
      switchMode('graph');
    }
    sendToServer({ req: 'activate', mode: app.mode, modified: app.notes[app.activenote].modified, lazy: true });
    return false;
  }
  else if (evt.key == 'F4') {
    if (app.mode == 'view') switchMode('edit');
    else switchMode('view');
    sendToServer({ req: 'activate', mode: app.mode, modified: app.notes[app.activenote].modified, lazy: true });
    return false;
  }
});

$().ready(function() {
  marked.setOptions({
    breaks: true
  });
  app.renderer = new marked.Renderer();
  app.renderer.link = function(href, title, text) {
    if ((text == '?') && href.match(/^#[0-9]+$/)) {
      let id = parseInt(href.substring(1));
      if (app.notes[id] && app.notes[id].title) text = app.notes[id].title;
      else text = '?';
    }
    return '<a href="' + href + '">' + text + '</a>';
  }
  app.graph = new sigma('graph');
  let data = { req: 'init' };
  if (location.hash.match(/^#[0-9]+$/)) data.activenote = location.hash.substr(1);
  sendToServer(data).always(function() { setInterval(tick, 5000); });
  $('#input').on('keydown', function(e) {
    if (e.originalEvent.ctrlKey && (e.originalEvent.code == 'Enter')) {
      app.addlink = true;
      sendToServer({ req: 'add' });
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
    sendToServer({ req: 'search', term: $('#search-input').val() });
    $('#search-input').select();
  });
  $('#button-note-add').on('click', function() {
    sendToServer({ req: 'add' });
  });
  $('#button-note-pin').on('click', function() {
    activateTab('pinned');
    if (app.notes[app.activenote].pinned < 1) {
      app.notes[app.activenote].pinned = true;
      let data = { req: 'update', notes: {} };
      data.notes[app.activenote] = {};
      data.notes[app.activenote].pinned = true;
      sendToServer(data);
    }
  });
  $('#buttons-mode').on('click', '.button-mode', function(e) {
    switchMode(this.id.split('-')[2]);
    sendToServer({ req: 'activate', mode: app.mode, modified: app.notes[app.activenote].modified, lazy: true });
  });
});

function unpinNote(id) {
  app.notes[id].pinned = 0;
  let data = { req: 'update', notes: {} };
  data.notes[id] = {};
  data.notes[id].pinned = 0;
  sendToServer(data);
}
function loadNote(id) {
  if (app.mode == 'view') $('#render').html(marked(app.notes[id].content, { renderer: app.renderer }));
  $('#input').val(app.notes[id].content).attr('disabled', false);
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
  else if (app.offline && (app.inactive%12 == 0)) sendToServer({ req: 'update' });
}

function pushUpdate(sync, retransmit) {
  let data = { req: 'update', activenote: app.activenote, notes: {} };
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
  if (data.mode && (data.mode != app.mode)) switchMode(data.mode);
  if (data.activenote) {
    if (app.addlink) {
      let input = $('#input')[0];
      let pos = input.selectionStart;
      let val = input.value;
      let link = '[?](#' + data.activenote + ')';
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
    if (data.notes[i].accessed) app.notes[i].accessed = data.notes[i].accessed;
    if (data.notes[i].modified) {
      app.notes[i].modified = data.notes[i].modified;
      if (app.notes[i].intransit) delete app.notes[i].intransit;
    }
    if (data.notes[i].pinned) app.notes[i].pinned = data.notes[i].pinned;
    if ((data.notes[i].content !== undefined) && (app.notes[i].content !== data.notes[i].content)) {
      app.notes[i].content = data.notes[i].content;
      if ((i == app.activenote) && !app.notes[app.activenote].touched) reload = true;
    }
  }
  if (reload) loadNote(app.activenote);
  if (data.searchresults) listSearchResults(data.searchresults);
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
  app.mode = newmode;
  if (app.mode == 'edit') {
    $('#render').hide().empty();
    $('#graph').hide();
    $('#input').show().focus();
  }
  else if (app.mode == 'view') {
    $('#input').hide();
    $('#render').html(marked($('#input').val(), { renderer: app.renderer })).show();
    $('#graph').hide();
  }
  else if (app.mode == 'graph') {
    $('#input').hide();
    $('#render').hide().empty();
    $('#graph').show();
    app.graph.graph.clear();
    for (let i in app.notes) {
      let note = app.notes[i];
      app.graph.graph.addNode({ id: String(i), label: note.title, x: 5, y: 5, size: 1 });
    }
    app.graph.refresh();
  }
  $('#button-mode-' + app.mode).addClass('button-active').siblings().removeClass('button-active');
}
function updatePanels() {
  let notes = Object.keys(app.notes).map(function(x) { return app.notes[x]; });
  if ($('#label-recent').hasClass('tab-active')) {
    notes.sort(function(a, b) { return b.modified - a.modified; });
    let count = 0;
    let last10 = "";
    for (let i in notes) {
      let note = notes[i];
      let extraclass = '';
      if (note.id == app.activenote) extraclass = ' note-active';
      last10 += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '"><span class="note-title">' + note.title + '</span><br>';
      last10 += '<span class="note-modified">Saved at ' + new Date(note.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
      if (++count*65 > $(window).height()) break;
    }
    $('#tab-recent').empty().html(last10);
  }
  else if ($('#label-pinned').hasClass('tab-active')) {
    notes.sort(function(a, b) { return (b.pinned||-1) - (a.pinned||-1); });
    count = 0;
    let pinned = "";
    for (let i in notes) {
      let note = notes[i];
      if (!note.pinned || (note.pinned == '0')) break;
      let extraclass = '';
      if (note.id == app.activenote) extraclass = ' note-active';
      pinned += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '">';
      pinned += '<img class="button-unpin" src="cross.svg" onclick="unpinNote(' + note.id + '); return false;" title="Unpin">';
      pinned += '<span class="note-title">' + note.title + '</span><br>';
      pinned += '<span class="note-modified">Saved at ' + new Date(note.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
      if (++count*65 > $(window).height()) break;
    }
    $('#tab-pinned').empty().html(pinned);
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
    let data = { req: 'activate', activenote: app.activenote, modified: app.notes[app.activenote].modified };
    if (app.notes[id].content !== undefined) {
      if (app.mode == 'graph') switchMode(app.prev);
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
    results += '<a href="#' + note.id + '"><div class="note-li' + extraclass + '"><span class="note-title">' + note.title + '</span><br>';
    results += '<span class="note-modified">Saved at ' + new Date(note.modified*1000).format('Y-m-d H:i') + '</span></div></a>';
  }
  $('#search-results').empty().html(results);
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

// date.format library (https://github.com/jacwright/date.format) by Jacob Wright and others - MIT license
(function(){Date.shortMonths=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],Date.longMonths=["January","February","March","April","May","June","July","August","September","October","November","December"],Date.shortDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],Date.longDays=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];var t={d:function(){return(this.getDate()<10?"0":"")+this.getDate()},D:function(){return Date.shortDays[this.getDay()]},j:function(){return this.getDate()},l:function(){return Date.longDays[this.getDay()]},N:function(){return 0==this.getDay()?7:this.getDay()},S:function(){return this.getDate()%10==1&&11!=this.getDate()?"st":this.getDate()%10==2&&12!=this.getDate()?"nd":this.getDate()%10==3&&13!=this.getDate()?"rd":"th"},w:function(){return this.getDay()},z:function(){var t=new Date(this.getFullYear(),0,1);return Math.ceil((this-t)/864e5)},W:function(){var t=new Date(this.valueOf()),e=(this.getDay()+6)%7;t.setDate(t.getDate()-e+3);var n=t.valueOf();return t.setMonth(0,1),4!==t.getDay()&&t.setMonth(0,1+(4-t.getDay()+7)%7),1+Math.ceil((n-t)/6048e5)},F:function(){return Date.longMonths[this.getMonth()]},m:function(){return(this.getMonth()<9?"0":"")+(this.getMonth()+1)},M:function(){return Date.shortMonths[this.getMonth()]},n:function(){return this.getMonth()+1},t:function(){var t=this.getFullYear(),e=this.getMonth()+1;return 12===e&&(t=t++,e=0),new Date(t,e,0).getDate()},L:function(){var t=this.getFullYear();return t%400==0||t%100!=0&&t%4==0},o:function(){var t=new Date(this.valueOf());return t.setDate(t.getDate()-(this.getDay()+6)%7+3),t.getFullYear()},Y:function(){return this.getFullYear()},y:function(){return(""+this.getFullYear()).substr(2)},a:function(){return this.getHours()<12?"am":"pm"},A:function(){return this.getHours()<12?"AM":"PM"},B:function(){return Math.floor(1e3*((this.getUTCHours()+1)%24+this.getUTCMinutes()/60+this.getUTCSeconds()/3600)/24)},g:function(){return this.getHours()%12||12},G:function(){return this.getHours()},h:function(){return((this.getHours()%12||12)<10?"0":"")+(this.getHours()%12||12)},H:function(){return(this.getHours()<10?"0":"")+this.getHours()},i:function(){return(this.getMinutes()<10?"0":"")+this.getMinutes()},s:function(){return(this.getSeconds()<10?"0":"")+this.getSeconds()},u:function(){var t=this.getMilliseconds();return(10>t?"00":100>t?"0":"")+t},e:function(){return/\((.*)\)/.exec((new Date).toString())[1]},I:function(){for(var t=null,e=0;12>e;++e){var n=new Date(this.getFullYear(),e,1),i=n.getTimezoneOffset();if(null===t)t=i;else{if(t>i){t=i;break}if(i>t)break}}return this.getTimezoneOffset()==t|0},O:function(){return(-this.getTimezoneOffset()<0?"-":"+")+(Math.abs(this.getTimezoneOffset()/60)<10?"0":"")+Math.floor(Math.abs(this.getTimezoneOffset()/60))+(0==Math.abs(this.getTimezoneOffset()%60)?"00":(Math.abs(this.getTimezoneOffset()%60)<10?"0":"")+Math.abs(this.getTimezoneOffset()%60))},P:function(){return(-this.getTimezoneOffset()<0?"-":"+")+(Math.abs(this.getTimezoneOffset()/60)<10?"0":"")+Math.floor(Math.abs(this.getTimezoneOffset()/60))+":"+(0==Math.abs(this.getTimezoneOffset()%60)?"00":(Math.abs(this.getTimezoneOffset()%60)<10?"0":"")+Math.abs(this.getTimezoneOffset()%60))},T:function(){return this.toTimeString().replace(/^.+ \(?([^\)]+)\)?$/,"$1")},Z:function(){return 60*-this.getTimezoneOffset()},c:function(){return this.format("Y-m-d\\TH:i:sP")},r:function(){return this.toString()},U:function(){return this.getTime()/1e3}};Date.prototype.format=function(e){var n=this;return e.replace(/(\\?)(.)/g,function(e,i,r){return""===i&&t[r]?t[r].call(n):r})}}).call(this);
