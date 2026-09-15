'use strict';

const {assertProviderContract}=require('./provider-contract');
const {SimulatorProvider}=require('./providers/simulator-provider');
const {CieloProvider}=require('./providers/cielo-provider');

class ProviderRegistry{
  constructor(providers=[new SimulatorProvider(),new CieloProvider()]){
    this.providers=new Map(providers.map(provider=>[provider.id,assertProviderContract(provider)]));
  }
  get(id){
    const provider=this.providers.get(String(id||''));
    if(!provider)throw Object.assign(new Error('Adquirente presencial não suportado.'),{code:'provider-not-supported'});
    return provider;
  }
  list(){return[...this.providers.values()];}
}

module.exports={ProviderRegistry};
