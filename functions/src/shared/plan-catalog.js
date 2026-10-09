(function(root, factory) {
  const catalog = factory();
  if (typeof module === 'object' && module.exports) module.exports = catalog;
  else root.VeconiPlanCatalog = catalog;
})(globalThis, function() {
  'use strict';
  // Stable billing IDs: professional = Gestão; premium = Pro. Never reinterpret legacy "pro".
  const version = 2;
  const tiers = {
    essential: ['basicSales','customers','fiado','receipts','messageCenter','basicStock','goals','simpleCampaigns','products','cloudBackup'],
    professional: ['crmAdvanced','advancedCampaigns','advancedReports','historyAnalytics','financeAdvanced','spreadsheetImport','advancedStock','onlineCatalog','onlineOrders','customerSubscriptions'],
    premium: ['teamManagement','permissions','operatorAudit','multipleTerminals','paymentTerminalIntegration','fiscalIntegration','automations','prioritySupport'],
  };
  const aliases = {
    sales:'basicSales',clients:'customers',creditAccounts:'fiado',payments:'fiado',stock:'basicStock',barcode:'basicStock',recentHistory:'customers',basicDashboard:'goals',reports:'advancedReports',financialModule:'financeAdvanced',basicFinance:'financeAdvanced',
    campaigns:'simpleCampaigns',crm:'crmAdvanced',crmExport:'crmAdvanced',bulkMessages:'messageCenter',loyalty:'advancedCampaigns',dataImport:'spreadsheetImport',advancedExports:'spreadsheetImport',advancedDashboard:'historyAnalytics',multipleUsers:'teamManagement',rolesPermissions:'permissions',futureIntegrations:'paymentTerminalIntegration',futureApi:'automations',
    'sales.create':'basicSales','customers.create':'customers','products.create':'products','campaigns.create':'simpleCampaigns','catalog.publish':'onlineCatalog','orders.receive':'onlineOrders','crm.view':'crmAdvanced','crm.export':'crmAdvanced','users.add':'teamManagement','variants.use':'products','reports.premium':'advancedReports','sync.write':'cloudBackup','payments.receive':'fiado','stock.adjust':'basicStock','balance.adjust':'fiado','finance.view':'financeAdvanced','finance.manage':'financeAdvanced',
  };
  const labels = {basicSales:'Vendas simples',customers:'Clientes e histórico do cliente',fiado:'Fiado, contas e recebimentos',receipts:'Recibos',messageCenter:'Central de Mensagens e cobranças',basicStock:'Estoque básico',goals:'Metas',simpleCampaigns:'Campanhas simples',products:'Produtos',cloudBackup:'Sincronização em nuvem',crmAdvanced:'CRM completo e segmentação',advancedCampaigns:'Campanhas avançadas',advancedReports:'Relatórios avançados',historyAnalytics:'Histórico e Desempenho',financeAdvanced:'Financeiro completo, contas a pagar/receber, fluxo de caixa, categorias e relatórios financeiros',spreadsheetImport:'Importação/exportação de produtos',advancedStock:'Estoque avançado',onlineCatalog:'Catálogo online',onlineOrders:'Pedidos online',customerSubscriptions:'Assinaturas de clientes',teamManagement:'Equipe e funcionários',permissions:'Cargos e permissões',operatorAudit:'Controle por operador',multipleTerminals:'Múltiplos terminais compatíveis',paymentTerminalIntegration:'Integração com maquininhas',fiscalIntegration:'Integração fiscal e notas — em breve',automations:'Automações disponíveis',prioritySupport:'Suporte prioritário'};
  const definitions = [['essential','Essencial',2990,'Controle simples para começar e organizar seu fiado.',1,300,500,1500],['professional','Gestão',5990,'Relacionamento, análises e gestão financeira completa.',3,2000,5000,10000],['premium','Pro',11990,'Equipe, permissões e operações integradas.',10,10000,25000,50000]];
  const plans={}, accumulated={};
  for(const [id,name,cents,summary,users,products,clients,monthlySales] of definitions){
    for(const key of tiers[id]) accumulated[key]=true;
    const features={...Object.fromEntries(Object.values(tiers).flat().map(key=>[key,false])),...accumulated};for(const [alias,key] of Object.entries(aliases))features[alias]=features[key]===true;
    plans[id]={id,name,summary,monthlyPrice:cents/100,yearlyPrice:Math.round(cents*12*80/100)/100,currency:'BRL',catalogVersion:version,trialDays:7,recommended:id==='professional',features,limits:{users,products,clients,monthlySales,catalogEnabled:features.onlineCatalog===true,campaignsEnabled:true}};
  }
  const normalizeFeature=key=>aliases[key]||key;
  const requiredPlan=key=>Object.keys(plans).find(id=>plans[id].features[normalizeFeature(key)])||null;
  const allows=(id,key)=>id==='internal'||plans[id]?.features[normalizeFeature(key)]===true;
  const routes={financeiro:'financeAdvanced',crm:'crmAdvanced',relatorios:'advancedReports',historico:'historyAnalytics',desempenho:'historyAnalytics',equipe:'teamManagement',catalogo:'onlineCatalog',pedidos:'onlineOrders',visitas:'onlineCatalog'};
  const campaignFeature=data=>(data.type||data.tipo)==='quantity_discount'&&(!data.eligibility?.audienceType||data.eligibility.audienceType==='all')?'simpleCampaigns':'advancedCampaigns';
  // V164 compatibility, not a sellable fourth plan. New gates must not remove
  // tools which were usable before the catalogue changed (history, XLSX, terminals).
  const legacyFeatures=id=>{
    const features={...plans[id]?.features};
    Object.assign(features,{financeAdvanced:true,crmAdvanced:true,historyAnalytics:true,advancedReports:true,spreadsheetImport:true,teamManagement:true,paymentTerminalIntegration:true});
    for(const [alias,key] of Object.entries(aliases))features[alias]=features[key]===true;
    return features;
  };
  const dateMs=value=>value?.toMillis?value.toMillis():value?.seconds!=null?value.seconds*1000:Date.parse(value||'');
  const legacyState=(subscription={},now=Date.now())=>{
    // The marker remains for cancellation recovery, but a confirmed replacement
    // already uses the approved V2 matrix; old entitlements must not override it.
    const replacementActive=subscription.catalogVersion===2&&Boolean(subscription.legacyMigration?.activatedAt);
    const legacy=!replacementActive&&(subscription.legacyPlan===true||Number(subscription.catalogVersion||1)<2&&subscription.hasPaidSubscription===true&&Boolean(plans[subscription.planId]));
    const transition=subscription.legacyTransition||{},end=dateMs(transition.paidThrough||subscription.currentPeriodEnd||subscription.expiresAt);
    const known=Number.isFinite(end),active=legacy&&(known?end>Number(now):['active','grace_period'].includes(subscription.status));
    return{legacy,active,expired:legacy&&known&&!active,needsReview:legacy&&!known,paidThrough:known?new Date(end).toISOString():null,showNotice:legacy&&(!known||end-Number(now)<=7*86400000),features:transition.features||legacyFeatures(subscription.planId),renewalStopped:['disabled','not_recurring'].includes(transition.renewalStatus)};
  };
  return Object.freeze({version,plans,tiers,aliases,labels,routes,normalizeFeature,requiredPlan,allows,campaignFeature,legacyFeatures,legacyState,dateMs});
});
