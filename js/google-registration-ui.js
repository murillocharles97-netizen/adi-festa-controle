const symbol=new URL('../assets/google-g.svg',import.meta.url).href;
function mount(form,controller,intent){
 if(!form||!controller.available(intent)||form.querySelector('[data-google-signin]'))return;
 const block=document.createElement('div');block.className='auth-google-entry';
 const button=document.createElement('button');button.type='button';button.className='auth-google-button';button.dataset.googleSignin='';
 const icon=document.createElement('img');icon.src=symbol;icon.alt='';icon.width=icon.height=20;
 const text=document.createElement('span');text.textContent=intent==='signup'?'Criar conta com Google':'Continuar com Google';button.append(icon,text);
 const note=document.createElement('p');note.className='auth-google-divider';note.textContent='Já se cadastrou com senha? Continue usando e-mail e senha.';
 const verify=document.createElement('button');verify.type='button';verify.className='auth-link';verify.textContent='Consultar resultado';verify.hidden=true;
 block.append(button,note,verify);form.prepend(block);
 const status=form.querySelector('#auth-error,.auth-error');
 function show(value){if(!form.isConnected||!status)return;status.textContent=value;status.setAttribute('role','alert');status.tabIndex=-1;status.focus();}
 button.onclick=async()=>{
  if(button.disabled||controller.busy()||form.querySelector('#login-submit')?.disabled)return;
  const nodes=[...form.querySelectorAll('button')],prior=nodes.map(x=>x.disabled);nodes.forEach(x=>x.disabled=true);button.setAttribute('aria-busy','true');
  try{if(intent==='signup')await controller.signUp({confirmed:true});else await controller.signIn();}
  catch(error){show(controller.message(error));verify.hidden=!controller.isPending();}
  finally{if(form.isConnected){nodes.forEach((x,n)=>x.disabled=prior[n]);button.removeAttribute('aria-busy');button.focus();}}
 };
 verify.onclick=async()=>{if(controller.busy())return;try{const r=await controller.verifyPending();show(r.message);verify.hidden=!controller.isPending();}catch(error){show(controller.message(error));}};
}
export function mountGoogleLogin(form,controller){mount(form,controller,'signin');}
export function mountGoogleSignup(form,controller){mount(form,controller,'signup');}
