/* Ajustes de apresentação independentes da lógica de vendas e dos dados locais. */
window.VisualUI=(()=>{
  const {escapar,dinheiro}=Utils;
  const initials=name=>String(name||'?').split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  function productEnhancements(){
    const list=document.querySelector('#entity-list');if(!list||list.dataset.visualReady)return;
    list.dataset.visualReady='1';
    const cards=[...list.querySelectorAll('.product-card')];
    cards.forEach(card=>{
      const id=card.querySelector('[data-edit-product]')?.dataset.editProduct;if(!id)return;
      const product=Produtos.obter(id);if(!product)return;
      const head=card.querySelector('.entity-head');
      if(head&&!head.querySelector('.product-avatar'))head.insertAdjacentHTML('afterbegin',`<span class="product-avatar">${product.imagem?`<img src="${escapar(product.imagem)}" alt="">`:initials(product.nome)}</span>`);
      if(head&&!head.querySelector('[data-toggle-favorite]'))head.insertAdjacentHTML('beforeend',`<button class="product-favorite ${product.favorito?'is-favorite':''}" data-toggle-favorite="${id}" aria-label="${product.favorito?'Remover dos favoritos':'Adicionar aos favoritos'}">${product.favorito?'★':'☆'}</button>`);
    });
    const sort=()=>{const all=[...list.querySelectorAll('.product-card')];all.sort((a,b)=>Number(Produtos.obter(b.querySelector('[data-edit-product]').dataset.editProduct).favorito)-Number(Produtos.obter(a.querySelector('[data-edit-product]').dataset.editProduct).favorito)).forEach(c=>list.append(c));};sort();
    list.addEventListener('click',e=>{const button=e.target.closest('[data-toggle-favorite]');if(!button)return;e.preventDefault();e.stopPropagation();const id=button.dataset.toggleFavorite;DB.alterar(db=>{const p=db.produtos.find(x=>x.id===id);p.favorito=!p.favorito});const p=Produtos.obter(id);button.classList.toggle('is-favorite',p.favorito);button.textContent=p.favorito?'★':'☆';button.setAttribute('aria-label',p.favorito?'Remover dos favoritos':'Adicionar aos favoritos');sort();});
  }
  function dashboardEnhancements(){
    if(window.MobileHome?.isMobile())return;
    const app=document.querySelector('#app');if(!app||app.dataset.dashboardVisual||Router.atual()!=='inicio')return;
    app.dataset.dashboardVisual='1';app.classList.add('dashboard-v2');
    const db=DB.carregar(),today=db.vendas.filter(v=>Utils.hoje(v.data)),sold=new Map();today.forEach(v=>(v.itens||[]).forEach(i=>sold.set(i.produtoId,{nome:i.nome,q:(sold.get(i.produtoId)?.q||0)+Number(i.quantidade||0),total:(sold.get(i.produtoId)?.total||0)+Number(i.subtotalFinal||0)})));const top=[...sold.values()].sort((a,b)=>b.q-a.q).slice(0,3),debt=db.clientes.filter(c=>Number(c.saldo)<0),out=db.produtos.filter(p=>getProductStockStatus(p)==='esgotado'),low=db.produtos.filter(p=>getProductStockStatus(p)==='baixo');
    const head=app.querySelector('.page-head');if(head)head.insertAdjacentHTML('afterend',`<section class="dashboard-intro"><div><h2>Olá! Vamos vender hoje? 👋</h2><p>Seu resumo rápido da Adi Festa.</p></div><button class="date-chip"><i data-lucide="calendar-days"></i>${new Date().toLocaleDateString('pt-BR')}</button></section>`);
    const quick=app.querySelector('.quick-actions');if(quick)quick.classList.add('quick-tabs');
    app.insertAdjacentHTML('beforeend',`<section class="dashboard-grid-extra"><article class="panel dashboard-alerts"><div class="panel-head"><h3>Alertas importantes</h3><span class="alert-count">${debt.length+out.length+low.length}</span></div>${debt.length?`<button data-go="clientes"><i data-lucide="users"></i><span><b>${debt.length} cliente(s) com fiado em aberto</b><small>Total: ${dinheiro(debt.reduce((s,c)=>s+Math.abs(Number(c.saldo)),0))}</small></span><i data-lucide="chevron-right"></i></button>`:''}${out.length?`<button data-go="produtos"><i data-lucide="triangle-alert"></i><span><b>${out.length} produto(s) sem estoque</b><small>${out.slice(0,2).map(p=>escapar(p.nome)).join(' e ')}</small></span><i data-lucide="chevron-right"></i></button>`:''}${low.length?`<button data-go="produtos"><i data-lucide="package-open"></i><span><b>${low.length} produto(s) com estoque baixo</b><small>Revise a reposição</small></span><i data-lucide="chevron-right"></i></button>`:''}${!debt.length&&!out.length&&!low.length?'<p class="empty compact">Nenhum alerta importante hoje.</p>':''}</article><article class="panel dashboard-top-products"><div class="panel-head"><h3>Top produtos hoje</h3></div>${top.length?top.map(p=>`<div><span class="top-product-avatar">${initials(p.nome)}</span><b>${escapar(p.nome)}</b><span><small>${p.q} un.</small><strong>${dinheiro(p.total)}</strong></span></div>`).join(''):'<p class="empty compact">Ainda não houve vendas hoje.</p>'}<button class="btn btn-light" data-go="relatorios"><i data-lucide="chart-no-axes-combined"></i> Ver relatório completo</button></article></section><section class="dashboard-tip"><span><i data-lucide="lightbulb"></i></span><div><h3>Dica para hoje</h3><p>Que tal enviar uma mensagem para seus clientes com fiado em aberto? Um lembrete educado ajuda a receber mais rápido.</p></div><button class="btn btn-primary" data-go="cobrancas"><i data-lucide="message-circle"></i> Enviar mensagens</button></section>`);
    app.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>Router.ir(b.dataset.go));window.lucide?.createIcons();
  }
  function apply(){if(Router.atual()==='produtos')productEnhancements();if(Router.atual()==='inicio')dashboardEnhancements()}
  function start(){addEventListener('hashchange',()=>setTimeout(apply,0));const watch=new MutationObserver(()=>setTimeout(apply,0));watch.observe(document.querySelector('#app'),{childList:true});setTimeout(apply,0)}
  return{start};
})();
