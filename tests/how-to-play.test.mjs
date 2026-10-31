import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const entry=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const help=readFileSync(new URL('../src/help/howToPlay.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/help/howToPlay.css',import.meta.url),'utf8');
const title="Galaga";
const slideCount=0;
test('Help button and user-requested rules are wired in main entry',()=>{
  assert.match(entry,/import \{ installHowToPlay \} from '\.\/help\/howToPlay\.js';/);
  assert.match(entry,/installHowToPlay\(\{/);
  assert.ok(entry.includes('title: '+JSON.stringify(title)),'game title missing');
  assert.match(entry,/steps:\s*\[/);
  assert.match(entry,/tips:\s*\[/);
  assert.match(help,/aria-label', 'How to Play'/);
  assert.match(help,/aria-modal', 'true'/);
  assert.match(help,/addEventListener\('click', close\)/);
  assert.match(help,/event\.key === 'Escape'/);
  assert.match(help,/document\.body\.append\(trigger, backdrop\)/);
});
test('Help remains visual-only, without wallet or navigation changes',()=>{
  assert.doesNotMatch(help,/window\.location\.(assign|replace)|fetch\(|\.pushState\(|\.replaceState\(/i);
  assert.match(css,/\.gp-help-backdrop\[hidden\]/);
  assert.match(css,/@media \(max-width:600px\)/);
});
test('Original tutorial illustrations are preserved for help when applicable',()=>{
  if(slideCount===0){assert.doesNotMatch(entry,/slideCount:\s*[1-9]/);return;}
  assert.ok(entry.includes('slideCount: '+slideCount));
  assert.match(entry,/slidePath: \(orientation, page\)/);
  for(const orientation of ['landscape','portrait']){
    for(const page of [1,slideCount]){
      assert.ok(existsSync(new URL('../public/assets/tutorial/'+orientation+'/'+page+'.png',import.meta.url)),
        'missing original tutorial '+orientation+'/'+page);
    }
  }
});

test('Help stays beside audio/settings rather than over it in desktop and mobile layouts',()=>{
  assert.match(entry,/audioSelectors:\s*\[/);
  assert.match(help,/querySelectorAll\(selector\)/);
  assert.match(help,/MutationObserver\(schedulePosition\)/);
  assert.match(help,/addEventListener\('orientationchange', schedulePosition/);
  const source=help.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
  const choose=new Function(source+'\nreturn chooseHelpPlacement;')();
  const layouts=[
    {width:1280,height:720,audioRect:{left:1220,top:12,right:1262,bottom:54}},
    {width:390,height:844,audioRect:{left:328,top:10,right:380,bottom:62}},
    {width:1280,height:720,audioRect:{left:14,top:14,right:58,bottom:58}},
    {width:1280,height:720,audioRect:{left:1123,top:12,right:1196,bottom:85}}
  ];
  for(const layout of layouts){
    const buttonWidth=44,buttonHeight=44;
    const spot=choose({...layout,buttonWidth,buttonHeight});
    const sound=layout.audioRect;
    assert.ok(spot.x>=9 && spot.y>=9,'Help must remain on screen');
    assert.ok(spot.x+buttonWidth<=layout.width-9,'Help must fit screen width');
    assert.ok(spot.y+buttonHeight<=layout.height-9,'Help must fit screen height');
    assert.ok(
      spot.x+buttonWidth<=sound.left-7 || spot.x>=sound.right+7 ||
      spot.y+buttonHeight<=sound.top-7 || spot.y>=sound.bottom+7,
      'Help must not overlap the sound/settings button');
  }
  const audioRect={left:320,top:12,right:364,bottom:56};
  const blockedRects=[{left:260,top:0,right:320,bottom:70}];
  const next=choose({width:390,height:844,buttonWidth:44,buttonHeight:44,audioRect,blockedRects});
  assert.ok(next.x+44<=blockedRects[0].left-7 || next.x>=blockedRects[0].right+7 ||
    next.y+44<=blockedRects[0].top-7 || next.y>=blockedRects[0].bottom+7,
    'Help must not cover adjacent game controls');
});
