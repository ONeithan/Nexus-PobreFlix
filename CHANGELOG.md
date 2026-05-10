# 📜 CHANGELOG INFINITO - Nexus PobreFlix Plugin

Este documento é a **Fonte da Verdade** para auditoria industrial do projeto.

---

## 🛡️ v1.0.0.11 (10/05/2026)
### COMPATIBILIDADE E ESTABILIDADE LEGACY

- **[CORE]** Refatoração industrial completa do módulo `watchlist.js` para **ES5 estrito**.
- **[FIX]** Removidas Arrow Functions, Template Literals, Const/Let, Spread e Optional Chaining para compatibilidade total com Jellyfin 10.11.x em hardware WebOS/Tizen.
- **[PERF]** Otimização do pool de workers de renderização usando encadeamento recursivo de Promises (Zero generators/async).
- **[META]** Sincronização de versão (v1.0.0.11) para build de produção industrial.

---

## 💎 v1.0.0.10 (08/05/2026)
### ESTABILIDADE E PURGA FINAL

- **[FIX]** Removidas funções "zumbis" em `settingsPage.js` que causavam o erro fatal `Unexpected token ')'`.
- **[UI]** Tradução massiva de `profileChooserPage.js` para Português Brasil (Purga de termos Turcos).
- **[WEB]** Corrigida a URL do módulo de configurações no `Web/settings.js` para o caminho correto do controlador.
- **[META]** Sincronização industrial de versão (v1.0.0.10) em todo o ecossistema do plugin.
- **[REPO]** Atualização dos links do repositório para `ONeithan/Nexus-PobreFlix`.

---

## ⚙️ v1.0.0.9 (08/05/2026)
### INDUSTRIALIZAÇÃO E POLLING DINÂMICO

- **[FEAT]** Polling dinâmico em Playlist, ArtistModal e ID3Reader.
- **[CACHE]** Otimização de cache ID3 com suporte a Base64.
- **[LOC]** Auditoria industrial PT-BR no Slider.

---
*Nexus PobreFlix — Integridade Industrial Absoluta.*
