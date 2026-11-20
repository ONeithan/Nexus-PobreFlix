# 🚀 Nexus PobreFlix Plugin — Lançamento Oficial v1.0.0.6 (Jellyfin 12.1 & .NET 10)

Esta atualização oficial **v1.0.0.6** corrige em definitivo o clique e a abertura suave do **Menu Hambúrguer (3 risquinhos)** em todos os modos (Desktop, TV e Celular), introduz a **Separação Exclusiva de Top 10 por Biblioteca** (Top 10 Animes, Top 10 Desenhos, Top 10 Novelas e Top 10 Séries com suas respectivas badges), amplia expressivamente a **Logo oficial** no cabeçalho (56px) para máxima nitidez, adiciona os **Filtros de Exclusão por Usuário** e implementa o **Image Shield** (bloqueio definitivo de capas contra sobrescrita automática do Jellyfin).

---

### 🌟 O que há de novo na versão v1.0.0.6:

* 🍔 **Menu Hambúrguer (3 Risquinhos) 100% Funcional e Deslizante em Todos os Modos**:
  - Corrigido o clique do menu que antes não abria devido a exceção interna do cliente do Jellyfin ao acessar o controller de gaveta.
  - O clique agora possui abertura direta garantida por DOM e transição suave em CSS, além de fechar automaticamente ao clicar em uma opção de biblioteca ou fora da gaveta.
  - Ícone vetorial SVG nítido em qualquer resolução (28px).

* 🧠 **Separação Exclusiva de Top 10 por Biblioteca**:
  - Acabou a mistura de animes, novelas e desenhos em uma linha genérica de "Top 10 Série".
  - O plugin analisa o nome real de cada biblioteca cadastrada no Jellyfin e gera carrosséis dedicados:
    - **`Top 10 Animes`** com badge **`⭐ Anime`** (somente itens da pasta Animes).
    - **`Top 10 Desenhos`** com badge **`📺 Desenho`** (somente desenhos).
    - **`Top 10 Novelas`** com badge **`📺 Novela`** (somente novelas).
    - **`Top 10 Séries`** com badge **`📺 Série`** (somente séries reais).
  - O **Hero Banner (Slider)** agora detecta corretamente animes (como *Diários de uma Apotecária*) exibindo `⭐ ANIME (3 TEMPORADAS)`.

* 🏷️ **Logo Oficial Ampliada no Cabeçalho (56px)**:
  - Altura aumentada de 46px para 56px (max 60px) para total legibilidade e destaque visual.

* 👤 **Filtros de Exclusão por Usuário (Configurações)**:
  - Permite escolher usuários cadastrados no Jellyfin e desativar recomendações de categorias específicas.

* 🔒 **Image Shield — Bloqueio Permanente de Capas (Anti-Sobrescrita)**:
  - Proteção local no servidor para impedir que o Jellyfin altere capas manuais (Shaun o Carneiro, Tico e Teco, etc.).

---

### 🛠️ Informações Técnicas e Checksum para Release:

- **Nome do Arquivo**: `NexusPobreFlix-1.0.0.6.zip`
- **Versão**: `1.0.0.6`
- **MD5 do ZIP**: `34b3ef0218a7db991b471bfb34b1caaa`
- **Target ABI**: `12.0.0.0` (Jellyfin 12.0 / 12.1 compilado em .NET 10)
- **Status**: Pronta para Publicação no GitHub Desktop

---

### 📝 Passo a Passo Exato para Subir no GitHub Desktop:

1. Abra o **GitHub Desktop**.
2. No repositório **Nexus-PobreFlix**, você verá os 7 arquivos modificados:
   - `JMSFusion.csproj`
   - `meta.json`
   - `manifest.json`
   - `Resources/slider/main.js`
   - `Resources/slider/modules/categoryDetector.js`
   - `Resources/slider/modules/recentRows.js`
   - `Resources/slider/src/slider.css`
3. No campo **Summary (Title)**, cole:
   ```text
   Release v1.0.0.6 - Correção Menu Hambúrguer, Top 10 por Biblioteca & Image Shield
   ```
4. Clique no botão azul: **Commit to main**.
5. Clique em **Push origin** no canto superior direito para enviar ao GitHub.
6. No seu navegador, vá na página do repositório no GitHub:
   - Clique em **Releases** -> **Draft a new release**.
   - No campo **Choose a tag**, digite: `v1.0.0.6` e clique em *Create new tag*.
   - No campo **Release title**, digite: `Nexus PobreFlix Plugin v1.0.0.6`
   - Arraste ou anexe o arquivo ZIP localizado em:
     `e:\Projetos\Projetos\Nexus-PobreFlix\dist's\NexusPobreFlix-1.0.0.6.zip`
   - Clique em **Publish release**.
