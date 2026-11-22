'use strict';
// Retired: no global publishing, portal snapshots or legacy fallback listeners.
// Scoped business sync and server-side V2 publication are authoritative.
// Loja Online V3: leitura única e pontual do documento PÚBLICO já publicado (o mesmo que
// qualquer visitante lê), para o painel mostrar o que ainda não foi publicado. Sem escrita.
import { db } from './firebase-config.js';
import { doc, getDocFromServer } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';

window.FirebasePublicCatalogReader = async token => {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) return null;
  const snapshot = await getDocFromServer(doc(db, 'publicCatalogs', token));
  return snapshot.exists() ? snapshot.data() : null;
};
