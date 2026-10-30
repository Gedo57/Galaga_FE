import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
for(const type of ['valid','duplicate','duplicateId','invalid','noId','orphanId','extra','failed']){
 const r=execFileSync(process.execPath,['scripts/patch109-provider-case.mjs',type],
  {encoding:'utf8',timeout:12000});
 assert.match(r,/PASS/,type);
}
console.log('P109 Galaga Provider launch FE: 8 cases PASS');
