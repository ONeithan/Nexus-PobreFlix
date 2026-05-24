# 🚀 Nexus PobreFlix Plugin — Lançamento Oficial v1.0.0.0

Esta é a primeira build estável oficial do fork **Nexus PobreFlix** para o Jellyfin. Ela traz a consolidação completa do motor visual premium roxo, layout imersivo baseado no Abyss, tela de login centralizada, suporte nativo offline para todos os recursos de marca e localização 100% absoluta para o Português do Brasil.

---

### 🌟 Destaques desta Release:

* **🟣 Branding e Identidade Visual Nexus**: Substituição total de cores rosadas e azuis pela paleta roxa oficial do Nexus (`#7a5cff`) em todos os sliders, botões, modais e menus de configuração.
* **🔒 Centralização Perfeita do Login**: O painel de login foi perfeitamente centralizado horizontalmente no desktop e mobile, com blindagem para que o formulário de login desapareça por completo após a autenticação bem-sucedida.
* **🛡️ Blindagem Absoluta do Logotipo**: Injeção do logotipo roxo local offline (`/Plugins/JMSFusion/assets/LogoPng`) aplicada de forma cirúrgica e com altíssima especificidade sobre os seletores de marca nativos do Jellyfin (`.headerLogo`, `.logoHeader` e `.headerLogoWithText`), garantindo a sua visibilidade permanente sem duplicidades e ocultando os SVGs originais.
* **🧼 Neutralização e Transparência do Cabeçalho**: Purga de cores cinzas sólidas e preenchimentos invasivos vindo de injeções de cache nas abas superiores (`.headerTabs`, `.emby-tabs` e `.emby-tabs-slider`), restaurando a transparência nativa limpa do Jellyfin.
* **🔊 Controle de Volume de Trailers a 5%**: Redução do volume padrão de trailers para 5% e atenuação temporária reativa para 1% sob hover do mouse (nos players de YouTube e HTML5 local), prevenindo picos de áudio incômodos.
* **🇧🇷 Localização PT-BR Absoluta**: Tradução e auditoria cirúrgica de todas as strings e menus administrativos, eliminando termos remanescentes em turco e inglês.
* **🌐 Autonomia Offline Completa**: Redirecionamento de todas as requisições de recursos gráficos (como logos) de servidores externos do GitHub para rotas locais offline embutidas no próprio plugin, possibilitando a autonomia total em redes domésticas fechadas.

---

### 📦 Informações de Instalação e Deploy:

#### 🛠️ Método Recomendado (Auto-Update via Repositório)
Adicione o link do manifesto abaixo em **Painel de Controle → Plugins → Repositórios** no seu Jellyfin:
```text
https://raw.githubusercontent.com/ONeithan/Nexus-PobreFlix/main/manifest.json
```

#### 📂 Instalação Manual
1. Baixe o arquivo `NexusPobreFlix-1.0.0.0.zip` anexado abaixo.
2. Crie uma pasta chamada `NexusPobreFlix` no diretório `plugins` do seu servidor Jellyfin.
3. Extraia o conteúdo do zip dentro da pasta.
4. Reinicie o servidor Jellyfin.
5. Limpe o cache do seu navegador (Ctrl + F5) para forçar o carregamento do novo design.

---
**Checksum MD5 da Build**: `ad02dbddf0af8612e62d7d155079efd4`

*Build processada e validada via Script Industrial por ONeithan e Antigravity.*
