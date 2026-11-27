# V242.14.1 — inicialização do PWA

A release parte de `cdafa3e` e inclui `47a1adc`. A V242.14.1 usa o cache `veconi-v242141-inicializacao-v1`, mantém a compatibilidade 242 e permite que a próxima etapa de desempenho continue como V242.15. O HTML, o catálogo e o precache usam o identificador novo para a versão do app. Os módulos de finanças, autenticação, sincronização e persistência são os da V242.14.

No Chromium com viewport mobile e Auth/Firestore no Emulator, uma instalação V242.14 já autenticada foi atualizada com IndexedDB preenchido. O Service Worker usou a cópia exata de `business-cache.js` quando a requisição ficou pendente. A sessão abriu em Início, e a venda fictícia, os dois itens da fila e o tema escuro permaneceram idênticos. A reabertura com o servidor estático indisponível também passou. Seis recursos do cache ativo foram comparados por hash. O teste usou apenas dados fictícios e preservou a fila sem enviá-la.

Publicação pelo GitHub Pages. Confirmar SHA no HTML, arquivos servidos, identidade do Service Worker e abertura anônima. Em caso de regressão crítica, publicar um novo commit sobre a main que reverta somente a estratégia introduzida por `47a1adc`, com a próxima versão corretiva livre e um cache novo. Manter o IndexedDB, os recibos e a fila, bem como o frontend de desempenho da V242.14.
