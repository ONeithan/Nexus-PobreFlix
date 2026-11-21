# 🚀 Nexus PobreFlix Plugin — Lançamento Oficial v1.0.0.11 (Jellyfin 12.1 & .NET 10)

Esta grande atualização oficial **v1.0.0.11** resolve todas as inconsistências visuais reportadas, moderniza a ergonomia dos carrosséis e atende rigorosamente a cada pedido feito:
1. **Fim total das marcas/tarjas brancas atrás dos textos e badges** (ex: "Anime 6 Temporadas", "Filme", "Assistindo", tags de metadados e duração) tanto no Modo TV quanto no Modo Desktop.
2. **Ocultação definitiva de tags técnicas poluídas** (`FHD`, `SDR`, `AVC`, `AAC`, etc.) em toda a interface e nos cards de "A Seguir" / "Recentes".
3. **Fundo Preto Total (#050505)** estendido por toda a tela, eliminando a linha de divisão cinza que ficava acima de "Novelas".
4. **Alinhamento e Imagens Reais em "Minha Mídia"**: Cards agora puxam as capas/backdrops reais das bibliotecas, com espaçamento e proporção alinhados com a grade do "Continuar Assistindo".
5. **Navegação por Drag com o Mouse e Setas no Hero Slider**: Agora é possível arrastar com o mouse para trocar de tela e usar o novo par de setas (`<` e `>`) centralizado abaixo das bolinhas.
6. **Rodízio Dinâmico do Top 10**: Em vez de carregar múltiplos blocos ao mesmo tempo, a tela inicial exibe um Top 10 que se alterna dinamicamente a cada visita (Filmes ➔ Séries ➔ Animes).
7. **Remover do Continuar Assistindo**: Adicionada opção nos 3 pontinhos para remover o item do carrossel; caso o usuário volte a assistir, ele reaparece automaticamente.
8. **Padronização Visual dos Cards**: Linhas de "A Seguir" e "Recentes" padronizadas no formato horizontal com bordas arredondadas (14px), sem poluição técnica e com visual idêntico ao modelo de referência.
9. **Filtro de Vistos no Slider Principal**: Filmes já assistidos e Séries com todas as temporadas concluídas são omitidas das recomendações; títulos em andamento recebem a marcação "Assistindo".
10. **Aba Sobre e Versionamento Atualizados**: Versão `1.0.0.11` exibida em todas as telas de configurações e manifestos.

---

### 🌟 Detalhes das Melhorias da v1.0.0.11:

* 🎨 **Eliminação das Tarjas Brancas nos Badges e Textos (Desktop & TV)**:
  - Estilização inline forçada e CSS com regras de alta especificidade garantindo fundo transparente (`background: transparent !important; box-shadow: none !important;`) em todos os `<span>` internos de metadados e badges de tipo.

* 🎬 **Remoção de Tags Técnicas Poluídas**:
  - Tags de formato e codecs como FHD, SDR, AVC e AAC foram completamente ocultadas dos cards e do carrossel principal para manter uma interface limpa e cinematográfica.

* ⬛ **Fundo Preto Puro Contínuo (#050505)**:
  - O corte de transição entre o preto superior e o cinza inferior foi extinto. O fundo escuro agora cobre homogeneamente toda a página inicial até o rodapé.

* 🗂️ **Cards de "Minha Mídia" com Arte Real e Alinhamento Preciso**:
  - Injeção automática das imagens das bibliotecas (Animes, Coleções, Desenhos, Filmes, Novelas) via API nativa do Jellyfin.
  - Alinhamento em 3.3% de margem lateral, combinando perfeitamente com a coluna de "Continuar Assistindo" e "Recomendações".

* 🖱️ **Interatividade no Hero Slider (Drag de Mouse + Botões de Seta)**:
  - Suporte completo a clicar e arrastar com o mouse horizontalmente para avançar ou retroceder slides.
  - Adição de uma elegante cápsula com botões de setas (`<` e `>`) abaixo dos pontos de navegação, facilitando o uso tanto com mouse no Desktop quanto no controle/D-pad da TV.

* 🔄 **Rodízio Automático do Top 10**:
  - O carrossel de Top 10 agora faz rodízio inteligente: cada vez que a página inicial é carregada, ele exibe um Top 10 temático diferente (Filmes, Séries ou Animes), economizando espaço e dinamizando o catálogo.

* ❌ **Remover do Continuar Assistindo com 1 Clique**:
  - Ao abrir os 3 pontinhos de qualquer card em "Continuar Assistindo", agora existe a opção **"Remover do Continuar Assistindo"**.
  - O item é ocultado imediatamente com persistência local. Se o item voltar a ser reproduzido posteriormente, ele retorna de forma automática.

* 📐 **Cards Padronizados de "A Seguir" e "Recentes"**:
  - Cards horizontais com bordas arredondadas (14px), fundo translúcido e animação suave ao passar o mouse, sem poluição de tags técnicas.

* 👁️ **Filtro Inteligente de Conteúdos Vistos no Slider**:
  - Filmes assistidos e séries com todas as temporadas terminadas são retirados das sugestões do slider principal. Se o usuário estiver no meio da exibição, o status muda dinamicamente de "Não assistido" para "Assistindo".

---

### 🛠️ Informações Técnicas e Checksum para Release:

- **Nome do Arquivo**: `NexusPobreFlix-1.0.0.11.zip`
- **Versão**: `1.0.0.11`
- **MD5 do ZIP**: `25dbf5aba23a518789c11b8696a355f3`
- **Tamanho**: `63.565.778 bytes`
- **Target ABI**: `12.0.0.0` (Jellyfin 12.0 / 12.1 compilado em .NET 10)
- **Status**: Compilado, Testado e Pronto para Publicação
