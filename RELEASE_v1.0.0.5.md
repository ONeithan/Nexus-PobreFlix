# 🚀 Nexus PobreFlix Plugin — Lançamento Oficial v1.0.0.5 (Jellyfin 12.1 & .NET 10)

Esta atualização oficial **v1.0.0.5** traz o menu de 3 risquinhos totalmente operacional e visível no **Modo TV**, amplia expressivamente o tamanho da **logo oficial** para máxima nitidez, introduz o **Reconhecimento Inteligente de Categorias** (separando Animes, Desenhos, Novelas, Séries e Filmes mesmo quando registrados como "Series" no Jellyfin), disponibiliza **Filtros de Exclusão por Usuário**, implementa o **Image Shield** definitivo (bloqueio permanente de capas contra sobrescrita automática do Jellyfin), registra o plugin no menu lateral do Jellyfin na seção **Plugins** e aperfeiçoa a ergonomia mobile com drawer em glassmorphism escuro de toque confortável.

---

### 🌟 O que há de novo na versão v1.0.0.5:

* 📺 **Menu Hambúrguer (3 Risquinhos) Funcional no Modo TV (`.layout-tv`)**:
  - No Modo TV, o cliente web do Jellyfin ocultava por padrão o botão do menu hambúrguer e a gaveta lateral (`.mainDrawerButton` e `.mainDrawer`).
  - O plugin agora força a exibição do botão de 3 risquinhos no cabeçalho em qualquer layout, com binding nativo a `LibraryMenu.onHardwareMenuButtonClick()` para abrir suavemente as bibliotecas na TV.

* 🏷️ **Logo Nexus PobreFlix Ampliada e Ultra-Nítida**:
  - A logo do cabeçalho superior esquerdo foi aumentada de `24px` para `46px` de altura no desktop e `36px` no mobile.
  - O container agora acomoda confortavelmente a marca com proporções de até `220px x 46px` sem recortes ou compressão.

* 🧠 **Reconhecimento Inteligente de Categorias (Animes, Desenhos, Novelas, Séries, Filmes)**:
  - O plugin agora detecta inteligentemente a verdadeira categoria de cada obra através do nome da biblioteca de origem, caminhos em disco (`/Animes/`, `/Novelas/`, `/Desenhos/`) e tags/gêneros.
  - Acabou a exibição de selo genérico de `📺 Série` em tudo:
    - **Animes**: recebem badge de destaque `⭐ Anime` e seção própria *"Animes Adicionados Recentemente"*.
    - **Desenhos**: recebem badge `📺 Desenho` e seção própria *"Desenhos Adicionados Recentemente"*.
    - **Novelas / Doramas**: recebem badge `📺 Novela` e seção própria *"Novelas Adicionadas Recentemente"*.
    - **Séries / Filmes**: mantêm seus selos e rotas normais.

* 👤 **Filtros de Exclusão por Usuário (Configurações)**:
  - Nova aba **"Filtros por Usuário"** no painel de configurações do plugin.
  - Puxa todos os perfis reais cadastrados no Jellyfin e permite marcar quais categorias ocultar do carrossel de recomendações de cada usuário (ex: nunca exibir Novelas ou Desenhos para determinado perfil).

* 🔒 **Image Shield — Bloqueio Permanente de Capas (Anti-Sobrescrita)**:
  - Solução definitiva para obras como *Shaun o Carneiro*, *Tico e Teco*, *Baby Looney Tunes*, cujas imagens eram revertidas pelo Jellyfin.
  - Nova aba **"Image Shield (Capas)"** no painel com formulário para travar pelo ID do item e galeria de capas ativas com miniatura e botão de desbloqueio.
  - Dupla blindagem: salva os bytes no diretório isolado do plugin (`locked_images/`), serve com cache imutável prioritário via `/Plugins/JMSFusion/Images/Serve/{id}` e trava os campos de metadados no Jellyfin.

* 📋 **Entrada Oficial na Seção "Plugins" do Menu Lateral do Jellyfin**:
  - O plugin agora se registra explicitamente em `MenuSection = "plugins"` com `EnableInMainMenu = true` e nome *"Nexus PobreFlix"*, aparecendo logo abaixo dos demais plugins (como Playback Reporting).

* 📱 **Adaptabilidade Mobile Refinada**:
  - Drawer lateral com fundo escuro glassmorphism (`rgba(13, 13, 24, 0.98)` e blur `16px`), eliminando o problema de transparência e corte de texto no celular.
  - Opções de menu com altura mínima de `46px` e espaçamento otimizado para toque no dedo.

---

### 🛠️ Informações Técnicas e Checksum:

- **Nome do Arquivo**: `NexusPobreFlix-1.0.0.5.zip`
- **Versão**: `1.0.0.5`
- **MD5 do ZIP**: `49078597e4c4fee81e441fecfcad5d29`
- **Target ABI**: `12.0.0.0` (Jellyfin 12.0 / 12.1 compilado nativamente em .NET 10)
- **Status**: Pronta para Publicação no GitHub Desktop
- **Data**: 19/11/2026

---

### 📝 Passo a Passo no GitHub Desktop:

1. Abra o **GitHub Desktop**.
2. Você verá as alterações prontas para commit no repositório **Nexus-PobreFlix**.
3. No campo **Summary (Title)**, insira: `Release v1.0.0.5 - TV Menu, Smart Categories, Image Shield & Mobile UX`
4. Clique em **Commit to main**.
5. Clique em **Push origin** para enviar as alterações ao GitHub.
6. No GitHub (na página do repositório):
   - Vá em **Releases** -> **Draft a new release**.
   - Crie a tag digitando exatamente: **`v1.0.0.5`** (com o `v` minúsculo).
   - Título: `Nexus PobreFlix Plugin v1.0.0.5`
   - Anexe o arquivo ZIP localizado em: `dist's/NexusPobreFlix-1.0.0.5.zip`
   - Clique em **Publish release**.
