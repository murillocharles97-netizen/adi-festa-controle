(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ProductModel=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  // Canonical builder extracted unchanged from Produtos.salvar (schema 14).
  function build(d,atual=null,{agora=new Date().toISOString(),barcode='',barcodeType=null,normalizeProductAccess}={}){
    const barcodeChanged=String(atual?.barcode||'')!==barcode;
    const estoque=d.estoqueAtual??d.estoque;
    const imageField=(name,fallback=null)=>d[name]!==undefined?d[name]:(atual?.[name]??fallback);
    const requestedType=d.productType??atual?.productType,productType=['variable','recurring'].includes(requestedType)?requestedType:'simple',hasVariations=productType==='variable'||Boolean(d.hasVariations??atual?.hasVariations),recurring=productType==='recurring',itemKind=(d.itemKind??atual?.itemKind)==='service'?'service':'product',controlsStock=itemKind==='service'?false:recurring?Boolean(d.controlaEstoque??(d.semControleEstoque===undefined?(atual?.controlaEstoque===true&&atual?.semControleEstoque!==true):false)):d.semControleEstoque!==undefined?!d.semControleEstoque:d.controlaEstoque!==undefined?d.controlaEstoque!==false:!(atual?.semControleEstoque||atual?.controlaEstoque===false),spaceAccess=normalizeProductAccess?.(d,atual||{})||{spaceAccessMode:['selected_spaces','single_space'].includes(d.spaceAccessMode??atual?.spaceAccessMode)?(d.spaceAccessMode??atual.spaceAccessMode):'all_spaces',allowedSpaceIds:Array.isArray(d.allowedSpaceIds)?[...new Set(d.allowedSpaceIds.map(String).filter(Boolean))]:(atual?.allowedSpaceIds||[]),defaultSpaceId:d.defaultSpaceId??atual?.defaultSpaceId??null,spaceScopeVersion:1};
    if(spaceAccess.spaceAccessMode!=='all_spaces'&&!spaceAccess.allowedSpaceIds.length)throw Error('Escolha ao menos um espaço de venda.');
    const v={nome:String(d.nome||'').trim(),itemKind,productType,hasVariations,attributes:Array.isArray(d.attributes)?d.attributes:(atual?.attributes||[]),durationValue:recurring?Math.max(1,Number(d.durationValue??atual?.durationValue??30)):null,durationUnit:recurring&&['days','weeks','months','years'].includes(d.durationUnit??atual?.durationUnit)?(d.durationUnit??atual?.durationUnit):(recurring?'days':null),renewalLabel:recurring?String(d.renewalLabel??atual?.renewalLabel??d.nome??'').trim():'',renewalMessage:recurring?String(d.renewalMessage??atual?.renewalMessage??'').trim():'',renewalReminders:recurring&&Array.isArray(d.renewalReminders)?d.renewalReminders:(atual?.renewalReminders||[]),codigo:d.codigo??atual?.codigo??'',barcode,barcodeType,barcodeUpdatedAt:barcodeChanged?agora:(atual?.barcodeUpdatedAt||null),alternateBarcodes:Array.isArray(atual?.alternateBarcodes)?atual.alternateBarcodes:[],preco:hasVariations?Number(d.minPrice??atual?.minPrice??d.preco??0):Number(d.preco||0),minPrice:Number(d.minPrice??atual?.minPrice??d.preco??0),maxPrice:Number(d.maxPrice??atual?.maxPrice??d.preco??0),custo:d.custo===''||d.custo===null?null:Number(d.custo??atual?.custo??0),estoqueAtual:hasVariations?Number(d.totalStock??atual?.totalStock??0):(estoque===''||estoque===null||estoque===undefined?0:Number(estoque)),totalStock:Number(d.totalStock??atual?.totalStock??estoque??0),activeVariationCount:Number(d.activeVariationCount??atual?.activeVariationCount??0),hasAvailableStock:Boolean(d.hasAvailableStock??atual?.hasAvailableStock),estoqueMinimo:Number(d.estoqueMinimo||0),categoria:d.categoria||'',observacao:d.observacao??atual?.observacao??'',semControleEstoque:!controlsStock,controlaEstoque:controlsStock,...spaceAccess,favorito:Boolean(d.favorito??atual?.favorito),ativo:d.ativo!==false,image:imageField('image'),imageMode:imageField('imageMode','own'),imagem:imageField('imagem',''),imageUrl:imageField('imageUrl'),imageStoragePath:imageField('imageStoragePath'),imageThumbUrl:imageField('imageThumbUrl'),imageThumbStoragePath:imageField('imageThumbStoragePath'),imageUpdatedAt:imageField('imageUpdatedAt'),imageUploadStatus:imageField('imageUploadStatus','none'),imageOperationId:imageField('imageOperationId'),schemaVersion:14,atualizadoEm:agora};
    if(atual?.serviceConfig&&(itemKind!=='service'||recurring||hasVariations))throw Error('Cadastre outro item para produto físico, variação ou renovação; este item usa execuções de serviço.');
    if(itemKind==='service'&&!recurring&&!hasVariations){
      const c=d.serviceConfig??atual?.serviceConfig;
      if(c){const model=typeof module==='object'&&module.exports?require('./flexible-service'):window.FlexibleService;
        v.serviceConfig=model.config(c);
        if(d.serviceCostConfig!==undefined||atual?.serviceCostConfig)v.serviceCostConfig=model.costConfig(d.serviceCostConfig??atual.serviceCostConfig);
        if(!d.serviceCostConfig&&v.serviceCostConfig&&d.custo!==undefined)v.serviceCostConfig=model.costConfig({...v.serviceCostConfig,rate:v.custo??0});
        if(v.serviceCostConfig)v.serviceConfig=model.config({...v.serviceConfig,requiresKm:v.serviceConfig.pricingModel==='km'||v.serviceCostConfig.model==='km',requiresMinutes:v.serviceConfig.pricingModel==='hour'||v.serviceCostConfig.model==='hour'});
        const previousCost=atual?.serviceCostConfig&&model.costConfig(atual.serviceCostConfig);
        if(atual?.serviceConfig?.id===v.serviceConfig.id&&v.serviceCostConfig&&
          (Number(v.preco)!==Number(atual.preco)||JSON.stringify(v.serviceCostConfig)!==JSON.stringify(previousCost))){
          const nextId=globalThis.crypto?.randomUUID?.();
          if(!nextId)throw Error('Não foi possível versionar a configuração. Atualize o aplicativo antes de salvar.');
          v.serviceConfig={...v.serviceConfig,id:nextId};
        }
      }
    }
    if((itemKind!=='service'||recurring||hasVariations)&&atual?.serviceConfig){v.serviceConfig=null;v.serviceCostConfig=null;}
    v.estoque=v.estoqueAtual;
    return v;
  }
  return Object.freeze({build});
});
