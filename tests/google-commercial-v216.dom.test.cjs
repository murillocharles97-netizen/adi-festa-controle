'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function dom(){return new JSDOM('<main id="gate"></main>',{url:'https://qa.example.test',runScripts:'outside-only'});}
function ui(w){w.eval(fs.readFileSync('js/google-registration-ui.js','utf8').replace(/^const symbol=.*$/m,"const symbol='./assets/google-g.svg';").replaceAll('export function','function')+';window.ui={mountGoogleLogin,mountGoogleSignup};');}
test('both commercial entry points are real buttons, no link UI, and errors preserve typed fields',async()=>{
 const d=dom(),w=d.window;ui(w);const gate=w.document.getElementById('gate');let calls=0;
 const c={available:()=>true,busy:()=>false,signIn:async()=>{calls++;throw Error('offline');},signUp:async({confirmed})=>{assert.equal(confirmed,true);calls++;throw Error('offline');},message:()=> 'Falha temporária; seus dados foram preservados.',isPending:()=>false};
 for(const [mount,label]of [['mountGoogleLogin','Continuar com Google'],['mountGoogleSignup','Criar conta com Google']]){
  gate.innerHTML='<form><input name="email" value="typed@example.test"><input name="name" value="Pessoa QA"><p class="auth-error"></p><button id="login-submit">Entrar</button></form>';
  const form=gate.querySelector('form');w.ui[mount](form,c);const b=form.querySelector('[data-google-signin]');assert.equal(b.type,'button');assert.equal(b.textContent,label);assert.doesNotMatch(form.textContent,/Vincular|Conectar Google|senha atual/);await b.onclick();assert.equal(form.elements.email.value,'typed@example.test');assert.equal(form.elements.name.value,'Pessoa QA');assert.equal(b.disabled,false);assert.equal(form.querySelector('.auth-error').getAttribute('role'),'alert');assert.match(form.textContent,/Falha temporária/);
 }
 assert.equal(calls,2);w.close();
});
test('Google welcome has no implicit onboarding and checks current UID before explicit choice',()=>{
 const d=dom(),w=d.window,source=fs.readFileSync('js/firebase/auth.js','utf8'),start=source.indexOf('function googleAccountWelcome('),end=source.indexOf('async function loadInvitePreview',start);let onboarding=0,logout=0,login=0;
 w.auth={currentUser:{uid:'qa-uid'}};w.googleAuth={restrictedPilot:()=>false};w.screen=html=>w.document.getElementById('gate').innerHTML=html;w.brandMarkup=()=>'<span>VECONI</span>';w.resumeOnboarding=()=>onboarding++;w.bootstrapLogout=()=>logout++;w.login=()=>login++;
 w.eval(source.slice(start,end)+';window.welcome=googleAccountWelcome;');w.welcome({uid:'qa-uid'});assert.equal(onboarding,0);assert.match(w.document.body.textContent,/Nenhuma empresa foi criada/);w.document.getElementById('google-start-business').click();assert.equal(onboarding,1);
 w.auth.currentUser={uid:'other'};w.document.getElementById('google-start-business').click();assert.equal(onboarding,1);assert.equal(login,1);w.document.getElementById('google-account-logout').click();assert.equal(logout,1);w.close();
});
test('commercial adaptations never change the commerce backend, permission UI or V215 recovery sources',()=>{
 const {execFileSync}=require('node:child_process'),base='285200d1d6c7cd668f991caf6b5d35dce7225887';
 for(const file of ['functions/src/index.js','functions/src/services/onboarding-service.js','firestore.rules','storage.rules','js/firebase/sync.js','js/sale-monetary-analysis-client.js','js/sale-monetary-recovery-ui.js','js/sale-recovery-client.js','js/desktop-settings.js','js/configuracoes-mobile.js']){
  const original=execFileSync('git',['show',base+':'+file],{encoding:'utf8'});assert.equal(fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'),original.replace(/\r\n/g,'\n'),file);
 }
});
