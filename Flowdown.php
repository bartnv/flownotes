<?php

require('3rdparty/Parsedown.php');

class Flowdown extends Parsedown {
  function __construct() {
    $this->InlineTypes['['][] = 'CheckBox';
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
      $title = sql_single('SELECT title FROM note WHERE id = ?', [ $id ]);
      $link['element']['attributes']['href'] = $id . ' - ' . str_replace('/', '-', $title) . '.html';
      if (substr($link['element']['handler']['argument'], 0, 1) == '=') {
        $link['element']['handler']['argument'] = substr($link['element']['handler']['argument'], 1);
      }
      $link['element']['attributes']['class'] = 'link-note';
    }
    return $link;
  }
}
