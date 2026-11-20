# Release v1.0.0.7 - Image Shield Automático, Redesign Moderno das Configurações, Botão Copiar Snippet, Correção Status e Drawer Hambúrguer TV/Desktop

Esta versão consolida melhorias profundas de usabilidade, estabilidade e automação visual para o ecossistema Jellyfin sob a identidade Nexus:

### 🛡️ 1. Image Shield Automático em Tempo Real (Proteção Anti-Sobrescrita)
- **Trava Automática de Capas**: O serviço `ImageShieldService` escuta os eventos `ItemUpdated` do Jellyfin em tempo real. Sempre que você alterar ou subir manualmente uma nova imagem de capa (poster) para qualquer filme, anime, série ou desenho pelo editor do Jellyfin, o plugin detecta e **trava a capa automaticamente**, sem você precisar copiar ou colar IDs manualmente!
- **Galeria de Capas Travadas**: A aba *Image Shield* lista todas as capas salvas pelo Shield com miniatura da imagem, título da obra, ID, data do bloqueio e botão de *🔓 Desbloquear*.

### 🎨 2. Redesign Completo e Moderno da Central de Controle (Settings UI)
- **Visual Cyberpunk Glassmorphism**: Adeus à interface cinza e cansativa do MonWUI. Toda a tela de configurações foi reestilizada com acabamento roxo neon/indigo premium, cartões translúcidos com efeito blur e bordas com brilho sutil.
- **Navegação por Abas em Pílulas**: Barra de abas moderna, arredondada e responsiva com ícones intuitivos (`🟣 Nexus PobreFlix`, `⚙️ Configurações`, `📊 Status`, `📜 Snippet HTML`, `👥 Filtros por Usuário`, `🛡️ Image Shield`).
- **Remoção da Aba "Sobre"**: Eliminada para despoluir a navegação e deixar o painel focado no que realmente importa.

### 📋 3. Botão "Copiar Snippet HTML" com 1 Clique
- Adicionado botão de destaque **📋 Copiar Snippet HTML** no cabeçalho da aba de Snippet.
- Cópia instantânea para a área de transferência do sistema com feedback visual (`✅ Copiado com sucesso!`) e notificação toast.

### 📊 4. Correção Definitiva da Aba Status (Eliminação dos Falsos "Não")
- Ajustada a verificação interna do backend e frontend: quando utilizando os recursos incorporados oficiais do pacote, os indicadores **Configurado**, **Recursos Disponíveis** e **Recursos Incorporados** agora exibem com precisão **Sim (Ativo)** com badges verdes.

### 📺 5. Correção do Menu Hambúrguer (3 Risquinhos) no Modo TV e Desktop
- **Fim da Borda Fina de 20px Travada**: O drawer lateral foi corrigido tanto no CSS quanto no JavaScript. Quando fechado, fica 100% oculto sem nenhuma sobra lateral visível.
- **Abertura Fluida em 320px**: Ao clicar nos 3 risquinhos, a barra lateral desliza suavemente sobre a tela com 320px de largura, estilo glassmorphism escuro, trazendo todas as bibliotecas.
- **Backdrop e Fechamento Fácil**: Adicionada máscara escura de fundo. Clicar fora do menu ou em qualquer opção de biblioteca fecha o drawer imediatamente de forma elegante.

### 🔤 6. Ampliação da Logo Nexus PobreFlix
- A logo do cabeçalho superior esquerdo foi ampliada para **64px de altura** no Desktop e **52px no Mobile**, garantindo legibilidade perfeita e presença marcante até em telas 4K de Smart TVs.

---

### Arquivo e Checksum
- **Arquivo ZIP**: `dist's/NexusPobreFlix-1.0.0.7.zip`
- **MD5**: `972b2b37c622e6d0a731b865ae942562`
