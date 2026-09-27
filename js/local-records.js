(function () {
  'use strict';
  // Firebase's IndexedDB databases belong to the SDK. This is the app's small,
  // structured operational store, exposed through the existing DB namespace.
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open('veconi-local-records', 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('records', { keyPath: 'key' });
        store.createIndex('scope', 'scope');
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => { database.close(); opening = null; };
        resolve(database);
      };
      request.onerror = () => { opening = null; reject(request.error); };
      request.onblocked = () => { opening = null; reject(Error('Feche outras abas da VECONI e tente novamente.')); };
    });
    return opening;
  }
  async function transaction(mode, action) {
    const database = await open();
    return new Promise((resolve, reject) => {
      let result, failure;
      const tx = database.transaction('records', mode, { durability: mode === 'readwrite' ? 'strict' : 'default' }), store = tx.objectStore('records');
      const fail = error => { failure = error; tx.abort(); };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || tx.error || Error('Não foi possível salvar o progresso.'));
      try { action(store, value => { result = value; }, fail); } catch (error) { fail(error); }
    });
  }
  const read = key => transaction('readonly', (store, done) => {
    const request = store.get(key); request.onsuccess = () => done(request.result || null);
  });
  const list = scope => transaction('readonly', (store, done) => {
    const request = store.index('scope').getAll(scope); request.onsuccess = () => done(request.result);
  });
  DB.localRecords = Object.freeze({ transaction, read, list });
})();
