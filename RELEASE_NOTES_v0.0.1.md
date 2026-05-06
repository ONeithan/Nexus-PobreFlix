# Nexus PobreFlix - Release v0.0.1 (Stable)

## 🎯 Objetivo
Esta versão marca a industrialização completa da identidade visual **Nexus Purple (#7B2FBE)** e a estabilização do motor de trailers (HoverTrailer) com persistência de preferências do usuário.

## 🚀 Novidades
- **Nexus Branding**: Substituição total de paletas legadas por tons de Roxo Nexus em toda a interface (Slider, Settings, Player).
- **HoverTrailer Estável**:
  - Persistência de volume via `localStorage` (padrão 80%).
  - Suporte total a trailers do YouTube com controle de áudio sincronizado.
  - Opção de visualização global (HoverTrailer Modal ou StudioHubs Mini).
- **Localização PT-BR**: Dicionário completo e revisado para todas as novas funcionalidades.
- **Limpeza de Código**: Erradicação de referências hardcoded a cores antigas e otimização de componentes de UI.

## 🛠️ Detalhes Técnicos
- **Versão**: v0.0.1
- **Caminho Base**: `c:\Projetos\Nexus PobreFlix\Nexus-PobreFlix-Plugin\`
- **Compatibilidade**: Jellyfin 10.8.x+
- **Variáveis CSS**: Padronizadas sob `--gmmp-accent-primary: #7B2FBE`.

## 📦 Componentes Principais Atualizados
- `hoverTrailerModal.js`: Motor de áudio e lógica de modal.
- `shared.js`: Componentes de UI utilitários (Range Input).
- `config.js`: Persistência de variáveis de branding e volume.
- `por.js`: Localização oficial.

---
*Nexus PobreFlix - Premium Media Experience*
