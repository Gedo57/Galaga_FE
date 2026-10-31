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
  assert.doesNotMatch(help,/window\.location\.(assign|replace)|fetch\(|\.pushState\(|\.replaceState\(|\bwallet\b|\bbet\b/i);
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
