# 📦 Nexus PobreFlix Plugin — Build v1.0.0.1 (Industrial)

Esta build oficial traz a implementação da integração portátil com a Steam, suporte nativo para Controles de Xbox / Steam Deck e melhorias importantes de privacidade e persistência de sessão.

---

### ⏱️ Ajustes e Atualizações Incrementais da Versão:

#### 🟢 [01/07/2026 - 04:30] — Ajustes de Navegação TV, Botão B e Foco Neon
* **Foco Neon Redondo (`box-shadow`)**: Removemos a borda de seleção (`outline`) padrão quadrada que ficava desalinhada. Adicionamos um efeito roxo neon com `box-shadow` que segue perfeitamente o arredondamento (`border-radius`) de posters, botões e listas no modo TV.
* **Navegação D-Pad Universal**: O script do controle agora simula teclas direcionais físicas de teclado tanto no modo TV quanto no modo Desktop. Isso resolveu o problema em que o controle não conseguia navegar pelas listas "Top 10" ou no modal de detalhes da mídia.
* **Botão B Universal (Voltar/Fechar)**: O botão B agora clica em botões de fechar ativos (como no diálogo de detalhes). Se não houver, simula `Escape` e aciona o histórico do navegador para fechar popups de forma segura.
* **Build Final de Produção**: DLL compilada em Release e ZIP re-gerado em `dist's/NexusPobreFlix-1.0.0.1.zip` com o hash MD5 `05e97bd92d30657e432ef71d2cda2e13`.

#### 🟢 [30/06/2026 - 21:00] — Lançamento Inicial do Suporte a Controles
* **Suporte Nativo a Gamepad**: Mapeamento básico da Gamepad API para navegação direcionada no Jellyfin TV.
* **Controles do Reprodutor**: Gatilhos LT/RT ajustam volume, bumpers LB/RB avançam/retrocedem 10s e Start alterna play/pause.
* **CSS Xbox Buttons**: Injeção da classe `jms-gamepad-mode` para indicar atalhos com botões visuais roxos de Xbox na tela.

---

### 🛠️ Detalhes do Build:

- **Arquivo**: `NexusPobreFlix-1.0.0.1.zip`
- **Versão**: `1.0.0.1`
- **MD5**: `05e97bd92d30657e432ef71d2cda2e13`
- **Status**: Pronta para Publicação
- **Data**: 01/07/2026

---

### 📄 Notas de Publicação:

Todos os arquivos foram empacotados no workspace local em `dist's/NexusPobreFlix-1.0.0.1.zip`. O snapshot CSS correspondente (`PobreFlix - v1.css`) está armazenado de forma incremental na mesma pasta. Para fazer deploy no servidor Jellyfin, extraia os conteúdos do ZIP (`Jellyfin.Plugin.JMSFusion.dll`, `meta.json` e `PobreFlix - v1.css`) na pasta de plugins do seu servidor, reinicie o Jellyfin e aproveite!

*Build processada e validada via Script Industrial por ONeithan e Antigravity.*

---

# 📦 Nexus PobreFlix Plugin — Build v1.0.0.0 (Industrial)

Esta é a primeira build estável oficial do fork **Nexus PobreFlix** para o Jellyfin. Ela traz a consolidação completa do motor visual premium roxo, layout imersivo baseado no Abyss, tela de login centralizada, suporte nativo offline para todos os recursos de marca e localização 100% absoluta para o Português do Brasil.

### 🚀 Changelog Industrial:

* **🟣 Branding e Identidade Visual Nexus**: Substituição total de cores rosadas e azuis pela paleta roxa oficial do Nexus (`#7a5cff`) em todos os sliders, botões, modais e menus de configuração.
* **🔒 Centralização Perfeita do Login**: O painel de login foi perfeitamente centralizado horizontalmente no desktop e mobile, com blindagem para que o formulário de login desapareça por completo após a autenticação bem-sucedida.
* **🛡️ Blindagem Absoluta do Logotipo**: Injeção do logotipo roxo local offline (`/Plugins/JMSFusion/assets/LogoPng`) aplicada de forma cirúrgica e com altíssima especificidade sobre os seletores de marca nativos do Jellyfin (`.headerLogo`, `.logoHeader` e `.headerLogoWithText`), garantindo a sua visibilidade permanente sem duplicidades e ocultando os SVGs originais.
* **🧼 Neutralização e Transparência do Cabeçalho**: Purga de cores cinzas sólidas e preenchimentos invasivos vindo de injeções de cache nas abas superiores (`.headerTabs`, `.emby-tabs` e `.emby-tabs-slider`), restaurando a transparência nativa limpa do Jellyfin.
* **🔊 Controle Inteligente de Trailers**: Redução do volume padrão de trailers para 5% e atenuação temporária reativa para 1% sob hover do mouse (nos players de YouTube e HTML5 local), prevenindo picos de áudio incômodos.
* **🇧🇷 Localização PT-BR Absoluta**: Tradução e auditoria cirúrgica de todas as strings e menus administrativos, eliminando termos remanescentes em turco e inglês.
* **🌐 Autonomia Offline Completa**: Redirecionamento de todas as requisições de recursos gráficos (como logos) de servidores externos do GitHub para rotas locais offline embutidas no próprio plugin, possibilitando a autonomia total em redes domésticas fechadas.

---

### 🛠️ Detalhes do Build:

- **Arquivo**: `NexusPobreFlix-1.0.0.0.zip`
- **Versão**: `1.0.0.0`
- **MD5**: `b9083a113574c96fe4d0cbf3af274cff`
- **Status**: Pronta para Publicação
- **Data**: 24/05/2026

---

### 📄 Notas de Publicação:

Esta é a build oficial de lançamento estável (v0). De acordo com a Regra #10, todos os arquivos foram empacotados no workspace local em `dist's/NexusPobreFlix-1.0.0.0.zip`. O snapshot CSS correspondente (`PobreFlix - v0.css`) está armazenado de forma incremental na mesma pasta. Para deploy, substitua a DLL do plugin na pasta correspondente do Jellyfin Server, reinicie o servidor e execute um Hard Refresh (Ctrl+F5) no navegador do cliente para limpar o cache de estilos.

*Build processada e validada via Script Industrial por ONeithan e Antigravity.*
