// No linking controls or password reauthentication in the registration-only UI.
export function confirmGoogleRegistration(document,preview){
 return new Promise(resolve=>{
  const previous=document.activeElement,bg=document.createElement('div'),dialog=document.createElement('section');bg.className='modal-bg google-registration-overlay';dialog.className='modal-box google-registration-dialog';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  const title=document.createElement('h2');title.textContent=preview.intent==='signup'?'Criar conta Google nova':'Entrar com Google';dialog.setAttribute('aria-label',title.textContent);
  const body=document.createElement('div');body.className='modal-body';const email=document.createElement('p');email.textContent='Google selecionado: '+preview.googleEmail;
  const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';label.append(check,document.createTextNode(preview.intent==='signup'?' Confirmo a criação de uma conta nova. Nenhuma empresa será criada automaticamente.':' Confirmo o acesso à minha conta já cadastrada com Google.'));
  const footer=document.createElement('footer');footer.className='modal-footer';const cancel=document.createElement('button'),yes=document.createElement('button');cancel.type=yes.type='button';cancel.className='btn btn-light';yes.className='btn btn-primary';cancel.textContent='Cancelar';yes.textContent=preview.intent==='signup'?'Criar minha conta':'Continuar';yes.disabled=true;
  function end(value){document.removeEventListener('keydown',key);bg.remove();if(previous?.isConnected)previous.focus();resolve(value);}
  function key(event){if(event.key==='Escape'){event.preventDefault();end(false);}else if(event.key==='Tab'){const list=[...dialog.querySelectorAll('input,button:not(:disabled)')],first=list[0],last=list.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}}
  cancel.onclick=()=>end(false);check.onchange=()=>yes.disabled=!check.checked;yes.onclick=()=>{if(check.checked)end(true);};
  body.append(email,label);footer.append(cancel,yes);dialog.append(title,body,footer);bg.append(dialog);document.body.append(bg);document.addEventListener('keydown',key);check.focus();
 });
}
