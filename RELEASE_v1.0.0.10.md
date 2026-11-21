# 🚀 Nexus PobreFlix Plugin — Lançamento Oficial v1.0.0.10 (Jellyfin 12.1 & .NET 10)

Esta grande atualização oficial **v1.0.0.10** atende diretamente aos pedidos e melhorias solicitadas:
1. **Limite Rígido de "Porque você assistiu" a no máximo 1 linha** (eliminando as 10 repetições de carrosséis).
2. **Fim total das "fisgadas", congelamentos e micro-stutters** ao carregar a página inicial.
3. **Reordenação nobre da Tela Inicial**: "Minha mídia" e "Continuar assistindo" agora ficam no topo, logo entre "Coleções de Estúdios" e "Recomendações Personalizadas".
4. **Redesign Moderno dos Cards de "Minha Mídia" e "Continuar Assistindo"**: estilo glassmorphism escuro com bordas e glow roxo Nexus (#7a5cff), cantos arredondados de 16px, zoom suave no hover e barras de progresso gradiente.
5. **Restauração e carregamento imediato do Top 10 por Biblioteca** (Top 10 Animes, Top 10 Desenhos, Top 10 Séries, Top 10 Filmes).
6. **Atualização da versão em Sobre / Fork** para 1.0.0.10.

---

### 🌟 O que há de novo na versão v1.0.0.10:

* 🎯 **Limite de "Porque Você Assistiu" a 1 Única Linha**:
  - Eliminado o comportamento de renderizar até 10 carrosséis pesados de "Porque você assistiu" com iframes de trailers e dezenas de cartões.
  - O sistema agora fixa estritamente em **no máximo 1 linha**, reduzindo drasticamente o consumo de CPU, conexões de rede e peso da página.

* ⚡ **Eliminação das "Fisgadas" (Travadas/Micro-Stutters) na Tela**:
  - O loop assíncrono que disparava checagens contínuas de IntersectionObserver e recalculava layouts a cada linha carregada foi finalizado.
  - A renderização da tela inicial agora ocorre de maneira estável, fluida e instantânea.

* 🔝 **Reordenação Estratégica da Tela Inicial**:
  - Nova hierarquia limpa e funcional:
    1. **Hero Slider** (Banner principal rotativo no topo)
    2. **Coleções de Estúdios** (Marvel, Disney, DC, Warner, etc.)
    3. **Minha Mídia** (Bibliotecas com cards modernos e categorizados)
    4. **Continuar Assistindo** (Seus conteúdos em andamento com barra de progresso)
    5. **Recomendações Personalizadas** (Incluindo 1 linha elegante de "Porque você assistiu")
    6. **Top 10 Séries, Animes e Desenhos**
    7. **Top 10 Filmes**
    8. **Recentes / Próximos Episódios**
  - Mapeamento multilíngue (incluindo PT-BR "Minha mídia" e "Continuar assistindo") para que as seções nativas sejam reconhecidas e encaixadas com precisão na posição correta.

* 💎 **Redesign Glassmorphism para Cards de "Minha Mídia" e "Continuar Assistindo"**:
  - Cards com cantos arredondados de 16px, fundo translúcido em vidro escuro e bordas sutis em neon roxo.
  - Efeito hover com elevação fluida (-5px) e glow roxo vibrante.
  - Barras de progresso em gradiente Nexus (#7a5cff -> #a855f7) com cantos arredondados.
  - Indicador roxo vertical nos títulos das seções para identidade visual marcante e coesa.

* 🏆 **Garantia de Exibição do Top 10 por Biblioteca**:
  - Fim da fila assíncrona que travava o Top 10 esperando os 10 carrosséis de "Porque você assistiu".
  - Top 10 Animes, Top 10 Desenhos, Top 10 Séries e Top 10 Filmes agora carregam rapidamente e ganham destaque logo após as recomendações.

---

### 🛠️ Informações Técnicas e Checksum para Release:

- **Nome do Arquivo**: `NexusPobreFlix-1.0.0.10.zip`
- **Versão**: `1.0.0.10`
- **MD5 do ZIP**: `10e380cd65148fad704a0d9ee409d12c`
- **Tamanho**: `63.561.052 bytes`
- **Target ABI**: `12.0.0.0` (Jellyfin 12.0 / 12.1 compilado em .NET 10)
- **Status**: Compilado, Testado e Implantado no Servidor Dell (192.168.1.151)
