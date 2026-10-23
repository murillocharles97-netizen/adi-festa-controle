'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/clientes-page.js','utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Event/DOM harness: drives the actual confirmation closure, without receiving a payment,
// accessing browser storage, contacting WhatsApp/Firebase, or simulating commercial Sync.
function harness({phone='',mobile=true,edit=true,share,clipboard}={}){
  const timers=[],opens=[],toasts=[],writes=[],rows={config:{nome:'QA Loja'},clientes:[{id:'c',nome:'QA Cliente',telefone:phone,saldo:-40,totalComprado:90,financialVersion:7,email:'qa@example.invalid',marketingConsent:true}],pagamentos:[{id:'payment-existing',valor:10}],vendas:[{id:'sale-existing'}],movimentacoes:[{id:'movement-existing'}]};
  const protectedBefore=JSON.stringify([rows.pagamentos,rows.vendas,rows.movimentacoes]);let generation=0,dialog=null,closed=0,refreshed=0,flush=async()=>{};
  const document={activeElement:null,querySelector:s=>s==='#modal'?root:root.querySelector(s)};
  class Control{
    constructor(tag,attrs={},value=''){this.tagName=tag.toUpperCase();this.attrs=attrs;this.value=value;this.disabled='disabled'in attrs;this.textContent='';this.generation=generation;this.classList={toggle:(name,on)=>this.error=on};}
    setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this.attrs[k]}getAttribute(k){return this.attrs[k]??null}
    focus(){document.activeElement=this}select(){this.selected=true}setSelectionRange(a,b){this.selection=[a,b]}
  }
  const root={html:'',controls:[],set innerHTML(value){this.html=value;generation++;this.controls=[];
    for(const m of value.matchAll(/<(button|input|textarea|a|form|p)\b([^>]*)>/g)){
      const attrs={};for(const a of m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';
      const content=m[1]==='textarea'?value.slice(m.index+m[0].length).split('</textarea>')[0]:attrs.value||'';
      this.controls.push(new Control(m[1],attrs,content));
    }
    dialog=new Control('section');dialog.querySelector=s=>this.querySelector(s);dialog.querySelectorAll=s=>this.querySelectorAll(s);
  },get innerHTML(){return this.html},contains:node=>node?.generation===generation,
  querySelector(s){if(s==='.payment-confirmation-dialog')return dialog;return this.querySelectorAll(s)[0]||null},
  querySelectorAll(s){if(s.includes(','))return this.controls.filter(n=>['BUTTON','INPUT','TEXTAREA','A'].includes(n.tagName)&&!n.disabled);
    if(s.startsWith('#'))return this.controls.filter(n=>n.attrs.id===s.slice(1));
    const m=s.match(/^(\w+)?(?:\[([^=\]]+)(?:="([^\"]*)")?\])?$/);if(!m)throw Error('Unhandled selector '+s);
    return this.controls.filter(n=>(!m[1]||n.tagName===m[1].toUpperCase())&&(!m[2]||m[2]in n.attrs&&(m[3]===undefined||n.attrs[m[2]]===m[3])));
  }};
  const c={window:null,document,console,Date,JSON,Math,encodeURIComponent,setTimeout:fn=>timers.push(fn),
    navigator:{share,clipboard},matchMedia:()=>({matches:mobile}),
    FirebaseSession:{user:{uid:'qa-owner'}},TeamAccess:{has:()=>edit,operationalReadScopeKey:()=>c.FirebaseSession.user.uid},
    DB:{getBusinessId:()=> 'qa-business',getWorkspaceGeneration:()=>0,carregar:()=>rows,alterar:fn=>{fn(rows);writes.push(structuredClone(rows))},flush:()=>flush()},
    Clientes:{obter:id=>rows.clientes.find(row=>row.id===id)},Utils:{telefoneWhatsApp:value=>c.PhoneUtils.normalizeBrazilianPhone(value),toast:(...v)=>toasts.push(v)},
    money:value=>`R$ ${Number(value).toFixed(2)}`,esc,icon:name=>`<i>${name}</i>`,Modais:{fechar:()=>closed++},refresh:()=>refreshed++,paymentCanvas:()=>{throw Error('receipt download is outside this test')},
    $:(selector,where=document)=>where.querySelector(selector),$$:(selector,where=document)=>[...where.querySelectorAll(selector)],open:(...args)=>opens.push(args)};
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('js/phone.js','utf8'),c);
  vm.runInContext(source.slice(source.indexOf('  function paymentSuccess('),source.indexOf('  function whatsapp(')),c);
  const payment=Object.freeze({id:'payment-existing',valor:10,saldoNovo:-40,saldoAnterior:-50,data:'2026-10-22T12:00:00Z'}),paymentBefore=JSON.stringify(payment);
  c.paymentSuccess(payment,rows.clientes[0]);timers.forEach(fn=>fn());
  const control=s=>{const n=root.querySelector(s);assert.ok(n,'Missing control '+s);return n};
  const click=s=>{const n=control(s);return n.onclick({currentTarget:n})};
  return{c,rows,root,opens,toasts,writes,control,click,dialog:()=>dialog,flush:fn=>flush=fn,edit:value=>edit=value,
    submit:()=>control('[data-payment-phone-form]').onsubmit({preventDefault(){}}),
    unchanged(){assert.equal(JSON.stringify([rows.pagamentos,rows.vendas,rows.movimentacoes]),protectedBefore);assert.equal(JSON.stringify(payment),paymentBefore)},
    stats:()=>({closed,refreshed})};
}

test('confirmed receipt WhatsApp stays enabled without phone and explains alternatives',()=>{
  const h=harness();assert.equal(h.control('#whatsapp-payment').disabled,false);h.click('#whatsapp-payment');
  assert.match(h.root.html,/Cliente sem WhatsApp cadastrado/);assert.match(h.root.html,/Cadastrar telefone/);assert.match(h.root.html,/Compartilhar pelo WhatsApp/);
  assert.match(h.root.html,/https:\/\/web.whatsapp.com\//);assert.match(h.root.html,/role="dialog" aria-modal="true"/);assert.equal(h.writes.length,0);h.unchanged();
});
test('valid Brazilian phone preserves ready-message direct WhatsApp URL',()=>{
  const h=harness({phone:'(11) 99999-8888'});h.click('#whatsapp-payment');assert.equal(h.opens.length,1);
  const url=new URL(h.opens[0][0]);assert.equal(url.pathname,'/5511999998888');assert.match(url.searchParams.get('text'),/Recebemos seu pagamento de R\$ 10.00/);assert.equal(h.opens[0][2],'noopener,noreferrer');h.unchanged();
});
test('invalid nonempty phone uses the same missing-phone dialog',()=>{const h=harness({phone:'123'});h.click('#whatsapp-payment');assert.match(h.root.html,/Cliente sem WhatsApp/);assert.equal(h.opens.length,0)});
test('mobile native share contains the confirmed message and makes no automatic WhatsApp choice',async()=>{
  const calls=[],h=harness({share:async data=>calls.push(data)});h.click('#whatsapp-payment');await h.click('[data-payment-share]');
  assert.equal(calls.length,1);assert.match(calls[0].text,/Saldo atual: R\$ 40.00/);assert.equal(h.opens.length,0);assert.match(h.control('[data-payment-feedback]').textContent,/aplicativo escolhido/);h.unchanged();
});
test('native share double click submits once; cancellation preserves receipt without error/retry',async()=>{
  let reject,calls=0;const h=harness({share:()=>{calls++;return new Promise((_,r)=>reject=r)}});h.click('#whatsapp-payment');
  const first=h.click('[data-payment-share]');await h.click('[data-payment-share]');assert.equal(calls,1);
  reject(Object.assign(Error('cancelled'),{name:'AbortError'}));await first;assert.equal(h.control('[data-payment-share]').disabled,false);
  assert.match(h.control('[data-payment-feedback]').textContent,/cancelado/);assert.equal(h.control('[data-payment-feedback]').error,false);assert.equal(h.opens.length,0);h.unchanged();
});
test('native sharing failure offers copy/Web without automatically opening or copying',async()=>{
  let copied=0;const h=harness({share:async()=>{throw Error('unavailable')},clipboard:{writeText:async()=>copied++}});h.click('#whatsapp-payment');await h.click('[data-payment-share]');
  assert.match(h.control('[data-payment-feedback]').textContent,/Copiar mensagem ou WhatsApp Web/);assert.equal(copied,0);assert.equal(h.opens.length,0);h.unchanged();
});
for(const opts of [{mobile:false,share:async()=>{throw Error('desktop should not call native share')}},{mobile:true}])test(`copy/Web fallback: ${opts.mobile?'mobile without share':'desktop'}`,async()=>{
  const copied=[],h=harness({...opts,clipboard:{writeText:async text=>copied.push(text)}});h.click('#whatsapp-payment');await h.click('[data-payment-share]');
  assert.match(h.control('[data-payment-feedback]').textContent,/WhatsApp Web/);await h.click('[data-payment-copy]');assert.equal(copied.length,1);assert.match(copied[0],/Recebemos seu pagamento/);h.unchanged();
});
test('clipboard denial provides selectable message and never claims copied',async()=>{
  const h=harness({clipboard:{writeText:async()=>{throw Error('denied')}}});h.click('#whatsapp-payment');await h.click('[data-payment-copy]');
  assert.equal(h.control('#payment-confirmed-message').selected,true);assert.match(h.control('[data-payment-feedback]').textContent,/Selecione e copie/);h.unchanged();
});
test('authorized phone registration changes only phone metadata; no new receipt or balance mutation',async()=>{
  const h=harness(),before={...h.rows.clientes[0]};h.click('#whatsapp-payment');h.click('[data-payment-phone]');h.control('#payment-client-phone').value='(11) 99999-8888';await h.submit();
  assert.equal(h.writes.length,1);const after=h.rows.clientes[0];assert.equal(after.normalizedPhone,'5511999998888');
  assert.deepEqual(Object.keys(after).filter(key=>before[key]!==after[key]).sort(),['atualizadoEm','normalizedPhone','telefone']);
  h.click('#whatsapp-payment');assert.equal(h.opens.length,1);h.unchanged();
});
test('phone registration rejects invalid and duplicate values before writes',async()=>{
  const h=harness();h.rows.clientes.push({id:'other',telefone:'11999998888'});h.click('#whatsapp-payment');h.click('[data-payment-phone]');
  h.control('#payment-client-phone').value='123';await h.submit();assert.equal(h.control('#payment-client-phone').attrs['aria-invalid'],'true');assert.equal(h.writes.length,0);
  h.control('#payment-client-phone').value='11999998888';await h.submit();assert.match(h.control('[data-payment-feedback]').textContent,/outro cliente/);assert.equal(h.writes.length,0);h.unchanged();
});
test('restricted operator may share but cannot register a phone',async()=>{
  let shared=0;const h=harness({edit:false,share:async()=>shared++});h.click('#whatsapp-payment');assert.equal(h.control('[data-payment-phone]').disabled,true);
  h.click('[data-payment-phone]');assert.equal(h.root.html.includes('data-payment-phone-form'),false);await h.click('[data-payment-share]');assert.equal(shared,1);assert.equal(h.writes.length,0);h.unchanged();
});
test('permission removal and account change fence stale save/share handlers',async()=>{
  const h=harness();h.click('#whatsapp-payment');h.click('[data-payment-phone]');h.control('#payment-client-phone').value='11999998888';h.edit(false);await h.submit();assert.equal(h.writes.length,0);
  const old=h.control('[data-payment-phone-cancel]').onclick;h.c.FirebaseSession.user.uid='different';old();assert.equal(h.writes.length,0);h.unchanged();
});
test('read-only plan cannot save phone even when role allows editing customers',()=>{
  const h=harness();h.c.FirebaseSession.access={readOnly:true,canMutate:false};h.click('#whatsapp-payment');
  assert.equal(h.control('[data-payment-phone]').disabled,true);assert.equal(h.writes.length,0);h.unchanged();
});
test('saving phone twice during durable flush only updates once; old completion cannot reopen UI after account switch',async()=>{
  const h=harness();let resolve;h.flush(()=>new Promise(r=>resolve=r));h.click('#whatsapp-payment');h.click('[data-payment-phone]');h.control('#payment-client-phone').value='11999998888';
  const first=h.submit();await h.submit();assert.equal(h.writes.length,1);const html=h.root.html;
  h.c.FirebaseSession.user.uid='new-owner';resolve();await first;assert.equal(h.root.html,html);h.unchanged();
});
test('stale native-share result never modifies a later account dialog',async()=>{
  let resolve;const h=harness({share:()=>new Promise(r=>resolve=r)});h.click('#whatsapp-payment');const pending=h.click('[data-payment-share]');
  const feedback=h.control('[data-payment-feedback]');h.c.FirebaseSession.user.uid='different';resolve();await pending;assert.equal(feedback.textContent,'');assert.equal(h.writes.length,0);h.unchanged();
});
test('Escape returns to confirmed receipt and restores trigger focus; Tab is contained',()=>{
  const h=harness();h.click('#whatsapp-payment');let prevented=0;
  const controls=h.root.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,a[href]');controls.at(-1).focus();h.dialog().onkeydown({key:'Tab',preventDefault(){prevented++}});
  assert.equal(h.c.document.activeElement,controls[0]);h.dialog().onkeydown({key:'Escape',preventDefault(){prevented++},stopPropagation(){}});
  assert.equal(h.c.document.activeElement,h.control('#whatsapp-payment'));assert.equal(prevented,2);assert.equal(h.writes.length,0);h.unchanged();
});
