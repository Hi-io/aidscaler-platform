import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { gitArchiveArgs, cleanPrivatePaths, safeChildEnvironment, allowedTrackedPath, validateAuthorization } from './local-clean-checkout-lf.mjs';

test('archive explicitly preserves LF bytes without changing repository Git configuration',()=>{
 const target=path.resolve('source archive.tar');
 assert.deepEqual(gitArchiveArgs(target),['-c','core.autocrlf=false','-c','core.eol=lf','archive','--format=tar','--output='+target,'HEAD']);
 assert.equal(gitArchiveArgs(target).includes('config'),false);
});
test('all fresh generated directories begin under ignored workspace storage, apart from immutable reports',()=>{
 const root=path.resolve('example-workspace'),report=path.join(root,'reports/local-closure/1791867000000-clean');
 const p=cleanPrivatePaths(root,report),expected=path.join(root,'.local/T27-private-builds/1791867000000-clean');
 assert.equal(p.base,expected);
 for(const v of [p.home,p.checkout,p.store]) { assert.ok(v.startsWith(expected+path.sep));assert.ok(!v.startsWith(report+path.sep)); }
});
test('private build path rejects external evidence, traversal and non-unique run identifiers',()=>{
 const root=path.resolve('example-workspace');
 assert.throws(()=>cleanPrivatePaths(root,path.resolve('other-workspace/reports/local-closure/1791867000000-clean')));
 assert.throws(()=>cleanPrivatePaths(root,path.join(root,'reports/local-closure/../../../escape/1791867000000-clean')));
 assert.throws(()=>cleanPrivatePaths(root,path.join(root,'reports/local-closure/not-clean')));
});
test('clean installation environment and archive path filters retain no inherited credentials or dependencies',()=>{
 const e=safeChildEnvironment({SystemRoot:'C:\\Windows',PATH:'private-parent-path',OPENROUTER_API_KEY:'sentinel',DATABASE_URL:'sentinel',NODE_OPTIONS:'sentinel',HTTP_PROXY:'sentinel',npm_config_userconfig:'sentinel'},path.resolve('fresh-home'),path.resolve('declared-node'));
 assert.equal(e.OPENROUTER_API_KEY,'');assert.equal(e.DATABASE_URL,'');
 for(const key of ['NODE_OPTIONS','HTTP_PROXY']) assert.equal(e[key],undefined);
 assert.ok(!e.PATH.includes('private-parent-path'));assert.ok(!e.npm_config_userconfig.includes('sentinel'));
 for(const p of ['.env','.env.local','src/AGENTS.md','.local/helper.mjs','node_modules/x.js'])assert.equal(allowedTrackedPath(p),false);
 assert.equal(allowedTrackedPath('.env.example'),true);
 assert.doesNotThrow(()=>validateAuthorization('clean','ROOT_GO_CLEAN_CHECKOUT'));
 assert.throws(()=>validateAuthorization('clean','ROOT_GO_FEDERATION'));
});
