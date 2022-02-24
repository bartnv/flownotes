<?php

require('3rdparty/Parsedown.php');

class Flowdown extends Parsedown {
  function __construct($mode) {
    $this->InlineTypes['['][] = 'CheckBox';
    $this->fn_mode = $mode;
    error_reporting(error_reporting() & ~E_NOTICE); // Silence PHP Notices because Parsedown is outdated
  }
  protected function inlineCheckBox($excerpt) {
    if (preg_match('/^\[(x| )\]/', $excerpt['text'], $matches)) {
      $ret = [
        'extent' => 3,
        'element' => [
          'name' => 'input',
          'attributes' => [
            'type' => 'checkbox'
          ]
        ]
      ];
      if ($matches[1] == 'x') $ret['element']['attributes']['checked'] = 'checked';
      return $ret;
    }
  }
  protected function inlineLink($excerpt) {
    $link = parent::inlineLink($excerpt);
    $href = $link['element']['attributes']['href']??null;
    if (!empty($href) && (preg_match('/^#\d+$/', $href))) {
      $id = substr($href, 1);
      if ($this->fn_mode == 'download') {
        $title = sql_single('SELECT title FROM note WHERE id = ?', [ $id ]);
        $link['element']['attributes']['href'] = $id . ' - ' . str_replace('/', '-', $title) . '.html';
      }
      else { // fn_mode == 'publish'
        $file = sql_single('SELECT file FROM publish WHERE note = ?', [ $id ]);
        if (empty($file)) $link['element']['attributes']['href'] = $id . '.html';
        else $link['element']['attributes']['href'] = '../' . $file;
      }
      if (substr($link['element']['handler']['argument'], 0, 1) == '=') {
        $link['element']['handler']['argument'] = substr($link['element']['handler']['argument'], 1);
      }
      $link['element']['attributes']['class'] = 'link-note';
    }
    return $link;
  }
  protected function blockFencedCode($excerpt) {
    $pre = parent::blockFencedCode($excerpt);
    if (!empty($excerpt['text']) && preg_match('/^[~`]+(.*)$/', $excerpt['text'], $matches)) {
      $pre['element']['attributes']['data-info'] = $matches[1];
    }
    return $pre;
  }
}
