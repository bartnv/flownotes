var app = {
  mode: 'edit',
  activenote: 1,
  notes: [],
  inactive: 0,
  changed: 0
}

$(document).on('keydown', function(evt) {
  if (evt.key == 'F2') {
    if (app.mode == 'graph') app.mode = app.prev;
    else {
      app.prev = app.mode;
      app.mode = 'graph';
    }
    updatePanels();
  }
  else if (evt.key == 'F4') {
    if (app.mode == 'view') app.mode = 'edit';
    else app.mode = 'view';
    updatePanels();
  }
});

$().ready(function() {
  marked.setOptions({
    breaks: true
  });
  app.graph = new sigma('graph');
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
    if (app.notes[app.activenote].touched) {
      app.notes[app.activenote].content = $('#input').val();
      app.notes[app.activenote].title = findTitle(app.notes[app.activenote].content);
    }
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
    if (data.notes[i].title) app.notes[i].title = data.notes[i].title;
    else app.notes[i].title = '{notitle}';
    if (data.notes[i].modified) app.notes[i].modified = data.notes[i].modified;
    if (data.notes[i].content !== undefined) app.notes[i].content = data.notes[i].content;
    if ((i == app.activenote) && !app.notes[app.activenote].touched) $('#input').val(app.notes[app.activenote].content);
  }
  updatePanels();
}
function updatePanels() {
  if (app.mode == 'edit') {
    $('#render').hide().empty();
    $('#graph').hide();
    $('#input').show();
  }
  else if (app.mode == 'view') {
    $('#input').hide();
    $('#render').html(marked($('#input').val())).show();
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
  app.notes.sort(function(a, b) { return b.modified - a.modified; });
  let count = 0;
  let last10 = "";
  for (let i in app.notes) {
    let note = app.notes[i];
    last10 += '<div class="note-li"><span class="note-title">' + note.title + '</span><br><span class="note-modified">' + new Date(note.modified*1000).format('Y-m-d H:i:s') + '</span></div>';
    if (++count == 10) break;
  }
  $('#panel-left').empty().html(last10);
}

function findTitle(text) {
  matches = text.match(/^\s*#+\s*([^#\r\n]+)/m);
  if (matches) return matches[1];
  else return 'notitle';
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
