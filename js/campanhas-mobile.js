(function () {
  "use strict";
  // O V2 usa uma única interface e um único contrato para mobile e desktop.
  // Este arquivo permanece apenas como ponto de compatibilidade com o carregador.
  window.CampanhasMobile = {
    enhance() {
      document.querySelector(".campaigns-page")?.classList.add("campaigns-mobile-ready");
    },
  };
})();
