# 🚀 Nexus PobreFlix Plugin — Lançamento Oficial v1.0.0.8 (Jellyfin 12.1 & .NET 10)

Esta atualização oficial **v1.0.0.8** resolve de forma definitiva o problema de tela escura no **Menu Hambúrguer (3 risquinhos)** restaurando a abertura e navegação suave em qualquer plataforma (Desktop, Celular e Modo TV), executa um **redesign completo do painel de configurações interno** sob a identidade visual roxa Nexus Cyberpunk (`#7a5cff`), remove a aba desnecessária "Sobre" do modal, torna os **checkboxes dos filtros de categorias 100% visíveis e interativos**, adiciona o botão de **cópia direta do Snippet HTML com 1 clique**, automatiza o **Image Shield** com monitoramento em tempo real do Jellyfin e amplia ainda mais a **Logo oficial** no cabeçalho (70px).

---

### 🌟 O que há de novo na versão v1.0.0.8:

* 🍔 **Correção Definitiva do Menu Hambúrguer (3 Risquinhos) — Fim da Tela Escurecida/Travada**:
  - Eliminado o conflito de eventos e a máscara escura que bloqueava a gaveta nativa do Jellyfin.
  - O clique agora delega perfeitamente ao motor de navegação (`LibraryMenu`) no Desktop, Celular e Smart TVs (`.layout-tv`), abrindo o menu com lista de bibliotecas de forma fluida e instantânea.

* ⚙️ **Redesign Completo do Painel de Configurações (Nexus Purple Cyberpunk)**:
  - Eliminação de todos os botões e detalhes verdes legados (`#10b981`), unificando a identidade sob o roxo Nexus (`#7a5cff` / `#9978ff`).
  - Abas laterais redesenhadas com maior espaçamento, sem sobreposição de texto ou quebras visuais (ex: *Visualização em Hover* e *Pré-show de Cinema*).
  - Remoção completa da sub-aba redundante "Sobre" no modal de configurações.

* 👥 **Filtros por Usuário 100% Visíveis e Funcionais**:
  - Checkboxes corrigidos com caixas de seleção roxas visíveis, grandes e clicáveis para cada categoria (Novelas, Desenhos, Animes, Séries, Filmes).

* 📋 **Botão "Copiar Snippet HTML" Direto**:
  - Botão com 1 clique que copia todo o código para a área de transferência com feedback visual dinâmico.

* 📊 **Correção de Indicadores de Status**:
  - Ajuste dos indicadores para 'Sim (Ativo)' e 'Sim (Prontos)' quando executando o pacote de recursos oficiais embutidos.

* 🛡️ **Image Shield Automático em Tempo Real**:
  - Monitoramento contínuo do Jellyfin (`ItemUpdated`) para bloquear e persistir automaticamente capas alteradas ou enviadas manualmente, com listagem de capas salvas.

* 🏷️ **Logo Nexus PobreFlix Ampliada (70px)**:
  - Dimensão aumentada para até 70px de altura no desktop e 54px no mobile para máxima imponência e legibilidade.

---

### 🛠️ Informações Técnicas e Checksum para Release:

- **Nome do Arquivo**: `NexusPobreFlix-1.0.0.8.zip`
- **Versão**: `1.0.0.8`
- **MD5 do ZIP**: `abdfc6d1e85fb4fb3ef58d7b403946d5`
- **Target ABI**: `12.0.0.0` (Jellyfin 12.0 / 12.1 compilado nativamente em .NET 10)
- **Status**: Pronta para Publicação
- **Data**: 20/11/2026
