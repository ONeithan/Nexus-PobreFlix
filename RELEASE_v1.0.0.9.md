# 🚀 Nexus PobreFlix Plugin — Lançamento Oficial v1.0.0.9 (Jellyfin 12.1 & .NET 10)

Esta atualização oficial **v1.0.0.9** separa completamente **Doramas** de **Novelas** (tratando Doramas como séries normais, mantendo a categoria 'Novelas' estritamente para telenovelas reais), e resolve de forma definitiva a **ocultação de Novelas da tela inicial** quando marcadas nos Filtros de Exclusão por Usuário.

---

### 🌟 O que há de novo na versão v1.0.0.9:

* 🎭 **Doramas Reconhecidos como Séries (Fim da Mistura com Novelas)**:
  - Doramas (K-Drama, C-Drama, Asian Drama) não são mais agrupados com Novelas. Eles pertencem à categoria legítima de **Séries**.
  - O rótulo e a exclusão nos filtros agora é estritamente **`🚫 Novelas (Ocultar novelas da tela inicial)`**.
  - Bibliotecas de Doramas agora mantêm seu título próprio de Séries ou `Top 10 Doramas` sem virar Novela.

* 🚫 **Ocultação Real e Imediata de Novelas Marcadas**:
  - Correção na fila de carregamento: as preferências de exclusão do usuário agora são aguardadas de forma síncrona antes do planejamento das seções da home.
  - As seções **`Novelas Adicionadas Recentemente`** e **`Top 10 Novelas`** são completamente ignoradas e não são mais geradas para usuários que marcaram a exclusão.
  - Itens de novelas são purgados do carrossel **Hero Banner (Slider principal)** e das **Recomendações Personalizadas**.
  - Mecanismo de limpeza no DOM que oculta qualquer seção remanescente com o termo Novela da tela inicial.
  - Normalização inteligente do ID de usuário (GUID com ou sem hífen, maiúsculas ou minúsculas) garantindo que a exclusão funcione independentemente de como o Jellyfin identifica o perfil.

---

### 🛠️ Informações Técnicas e Checksum para Release:

- **Nome do Arquivo**: `NexusPobreFlix-1.0.0.9.zip`
- **Versão**: `1.0.0.9`
- **MD5 do ZIP**: `c8a30b7eb7f15f549aed1f8f4f8d0b9c`
- **Target ABI**: `12.0.0.0` (Jellyfin 12.0 / 12.1 compilado nativamente em .NET 10)
- **Status**: Pronta para Publicação
- **Data**: 20/11/2026
